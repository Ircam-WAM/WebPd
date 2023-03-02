/*
 * Copyright (c) 2012-2020 Sébastien Piquemal <sebpiq@gmail.com>
 *
 * BSD Simplified License.
 * For information on usage and redistribution, and for a DISCLAIMER OF ALL
 * WARRANTIES, see the file, "LICENSE.txt," in this distribution.
 *
 * See https://github.com/sebpiq/WebPd_pd-parser for documentation
 *
 */

import { DspGraph } from '@webpd/compiler-js'
import { Code, CodeVariableName, NodeImplementation, NodeImplementations, SharedCodeGenerator } from '@webpd/compiler-js/src/types'
import { NodeBuilder } from '../types'
import { assertOptionalNumber } from '../nodes-shared-code/validation'
import {
    coldFloatInletWithSetter,
} from '../nodes-shared-code/standard-message-receivers'

interface NodeArguments {
    initValue: number
}
const stateVariables = {
    lastInput: 1,
    lastOutput: 1,
    coeff: 1,
    funcSetCoeff: 1,
}
type _NodeImplementation = NodeImplementation<
    NodeArguments,
    typeof stateVariables
>

// TODO : tests + cleaner implementations
// TODO : separate rfilters with lastInput from the ones that don't need
// ------------------------------- node builder ------------------------------ //
const builder: NodeBuilder<NodeArguments> = {
    translateArgs: ({ args }) => ({
        initValue: assertOptionalNumber(args[0]) || 0,
    }),
    build: () => ({
        inlets: {
            '0': { type: 'signal', id: '0' },
            '1': { type: 'signal', id: '1' },
            '1_message': { type: 'message', id: '1_message' },
        },
        outlets: {
            '0': { type: 'signal', id: '0' },
        },
    }),
    rerouteMessageConnection: (inletId) => {
        if (inletId === '1') {
            return '1_message'
        }
        return undefined
    },
}

const makeNodeImplementation = ({
    generateOperation,
    computeCoeff = () => 'value',
}: {
    generateOperation: (
        input: Code,
        coeff: Code,
        lastOutput: Code,
        lastInput: Code,
    ) => Code,
    computeCoeff?: (sampleRate: CodeVariableName) => Code,
}): _NodeImplementation => {

    // ------------------------------- declare ------------------------------ //
    const declare: _NodeImplementation['declare'] = (context) =>
        _hasSignalInput(context.node)
            ? declareSignal(context)
            : declareMessage(context)

    const declareSignal: _NodeImplementation['declare'] = ({
        state,
        macros: { Var },
    }) => `
        let ${Var(state.lastOutput, 'Float')} = 0
        let ${Var(state.lastInput, 'Float')} = 0
    `

    const declareMessage: _NodeImplementation['declare'] = ({
        state,
        globs,
        node: { args },
        macros: { Var, Func },
    }) => `
        let ${Var(state.lastOutput, 'Float')} = 0
        let ${Var(state.lastInput, 'Float')} = 0
        let ${Var(state.coeff, 'Float')} = 0

        function ${state.funcSetCoeff} ${Func([
            Var('value', 'Float')
        ], 'void')} {
            ${state.coeff} = ${computeCoeff(globs.sampleRate)}
        }

        commons_waitEngineConfigure(() => {
            ${state.funcSetCoeff}(${args.initValue})
        })
    `

    // ------------------------------- loop ------------------------------ //
    const loop: _NodeImplementation['loop'] = (context) =>
        _hasSignalInput(context.node)
            ? loopSignal(context)
            : loopMessage(context)

    const loopSignal: _NodeImplementation['loop'] = ({ ins, state, outs }) => `
        ${state.lastOutput} = ${outs.$0} = ${generateOperation(ins.$0, ins.$1, state.lastOutput, state.lastInput)}
        ${state.lastInput} = ${ins.$0}
    `

    const loopMessage: _NodeImplementation['loop'] = ({ ins, state, outs }) => `
        ${state.lastOutput} = ${outs.$0} = ${generateOperation(ins.$0, state.coeff, state.lastOutput, state.lastInput)}
        ${state.lastInput} = ${ins.$0}
    `

    // ------------------------------- messages ------------------------------ //
    const messages: _NodeImplementation['messages'] = ({ globs, state }) => ({
        '1_message': coldFloatInletWithSetter(globs.m, state.funcSetCoeff),
    })

    return {
        loop,
        stateVariables,
        messages,
        declare,
    }
}

// ------------------------------------------------------------------- //
const _hasSignalInput = (node: DspGraph.Node<NodeArguments>) =>
    node.sources['1'] && node.sources['1'].length

const builders = {
    'rpole~': builder,
    'rzero~': builder,
    'rzero_rev~': builder,
    'hip~': builder,
    'lop~': builder,
}

const nodeImplementations: NodeImplementations = {
    'rpole~': makeNodeImplementation({
        generateOperation: (input, coeff, lastOutput) => `${input} + ${coeff} * ${lastOutput}`,
    }),
    'rzero~': makeNodeImplementation({
        generateOperation: (input, coeff, _, lastInput) => `${input} - ${coeff} * ${lastInput}`,
    }),
    'rzero_rev~': makeNodeImplementation({
        generateOperation: (input, coeff, _, lastInput) => `${lastInput} - ${coeff} * ${input}`
    }),
    'hip~': makeNodeImplementation({
        generateOperation: (input, coeff, lastOutput, lastInput) => `${coeff} * (${lastOutput} + ${input} - ${lastInput})`,
        computeCoeff: (sampleRate) => `Math.min(1, Math.max(0, 1 - Math.max(0, value) * 2 * Math.PI / ${sampleRate}))`
    }),
    'lop~': makeNodeImplementation({
        generateOperation: (input, coeff, lastOutput) => `${lastOutput} + ${coeff} * (${input} - ${lastOutput})`,
        computeCoeff: (sampleRate) => `Math.min(1, Math.max(0, Math.max(0, value) * 2 * Math.PI / ${sampleRate}))`
    }),
}

export { builders, nodeImplementations, NodeArguments }
