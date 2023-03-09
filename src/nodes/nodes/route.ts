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

import { DspGraph, functional } from '@webpd/compiler-js'
import { NodeImplementation } from '@webpd/compiler-js/src/types'
import { NodeBuilder } from '../../compile-dsp-graph/types'
import { bangUtils, msgUtils } from '../nodes-shared-code/core'

interface NodeArguments {
    filters: Array<number | string>
}
const stateVariables = {
    filterType: 1,
    floatFilter: 1,
    stringFilter: 1,
}
type _NodeImplementation = NodeImplementation<
    NodeArguments,
    typeof stateVariables
>

// ------------------------------- node builder ------------------------------ //
const builder: NodeBuilder<NodeArguments> = {
    translateArgs: ({ args }) => ({
        filters: args.length ? args: [0],
    }),
    build: (args) => {
        const inlets: DspGraph.PortletMap = {
            '0': { type: 'message', id: '0' },
        }

        if (args.filters.length === 1) {
            inlets['1'] = { type: 'message', id: '1' }
        }

        return {
            inlets,
            outlets: functional.mapArray(
                args.filters.length ? functional.countTo(args.filters.length + 1) : [0, 1],
                (_, i) => [`${i}`, { type: 'message', id: `${i}` }],
            ),
        }
    },
}

// ------------------------------- declare ------------------------------ //
const declare: _NodeImplementation['declare'] = ({
    node: { args },
    state,
    macros: { Var },
}) => functional.renderCode`
    ${functional.renderIf(args.filters.length === 1, `
        let ${Var(state.floatFilter, 'Float')} = ${typeof args.filters[0] === 'number' ? args.filters[0]: 0}
        let ${Var(state.stringFilter, 'string')} = "${args.filters[0]}"
        let ${Var(state.filterType, 'Int')} = ${
            typeof args.filters[0] === 'number' ? 'MSG_FLOAT_TOKEN' : 'MSG_STRING_TOKEN'}
    `)}
`

// ------------------------------- messages ------------------------------ //
const messages: _NodeImplementation['messages'] = ({ snds, globs, state, node: { args } }) => {
    if (args.filters.length > 1) {
        return {
            '0': functional.renderCode`
        
            ${args.filters.map((filter, i) => functional.renderSwitch(
                [filter === 'float', `
                    if (msg_isFloatToken(${globs.m}, 0)) {
                        ${snds[i]}(${globs.m})
                        return
                    }
                `],
                [filter === 'symbol', `
                    if (msg_isStringToken(${globs.m}, 0)) {
                        ${snds[i]}(${globs.m})
                        return
                    }
                `],
                [filter === 'list', `
                    if (msg_getLength(${globs.m}).length > 1) {
                        ${snds[i]}(${globs.m})
                        return
                    }
                `],
                [filter === 'bang', `
                    if (msg_isBang(${globs.m})) {
                        ${snds[i]}(${globs.m})
                        return
                    }
                `],
                [typeof filter === 'number', `
                    if (
                        msg_isFloatToken(${globs.m}, 0)
                        && msg_readFloatToken(${globs.m}, 0) === ${filter}
                    ) {
                        ${snds[i]}(msg_emptyToBang(msg_shift(${globs.m})))
                        return
                    }
                `],
                [typeof filter === 'string', `
                    if (
                        msg_isStringToken(${globs.m}, 0) 
                        && msg_readStringToken(${globs.m}, 0) === "${filter}"
                    ) {
                        ${snds[i]}(msg_emptyToBang(msg_shift(${globs.m})))
                        return
                    }`
                ],
            ))}

            ${snds[args.filters.length]}(${globs.m})
            return
            `
        }
    
    } else {
        return {
            '0': `
            if (${state.filterType} === MSG_STRING_TOKEN) {
                if (
                    (${state.stringFilter} === 'float'
                        && msg_isFloatToken(${globs.m}, 0))
                    || (${state.stringFilter} === 'symbol'
                        && msg_isStringToken(${globs.m}, 0))
                    || (${state.stringFilter} === 'list'
                        && msg_getLength(${globs.m}) > 1)
                    || (${state.stringFilter} === 'bang' 
                        && msg_isBang(${globs.m}))
                ) {
                    ${snds.$0}(${globs.m})
                    return
                
                } else if (
                    msg_isStringToken(${globs.m}, 0)
                    && msg_readStringToken(${globs.m}, 0) === ${state.stringFilter}
                ) {
                    ${snds.$0}(msg_emptyToBang(msg_shift(${globs.m})))
                    return
                }

            } else if (
                msg_isFloatToken(${globs.m}, 0)
                && msg_readFloatToken(${globs.m}, 0) === ${state.floatFilter}
            ) {
                ${snds.$0}(msg_emptyToBang(msg_shift(${globs.m})))
                return
            }
        
            ${snds.$1}(${globs.m})
            return
            `,

            '1': `
            ${state.filterType} = msg_getTokenType(${globs.m}, 0)
            if (${state.filterType} === MSG_STRING_TOKEN) {
                ${state.stringFilter} = msg_readStringToken(${globs.m}, 0)
            } else {
                ${state.floatFilter} = msg_readFloatToken(${globs.m}, 0)
            }
            return
            `
        }
    }
    
}

// ------------------------------------------------------------------- //
const nodeImplementation: _NodeImplementation = { 
    messages, 
    stateVariables, 
    declare,
    sharedCode: [ bangUtils, msgUtils ]
}

export { builder, nodeImplementation, NodeArguments }
