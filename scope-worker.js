/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global self, importScripts, esprima, findChildScope, getAllIdentifiersInScope */

(function () {
    'use strict';

    importScripts('scope.js');
    
    function _getScope(outerScope, offset) {
        var cursorScope;
        
        cursorScope = outerScope.findChild(offset);
        if (cursorScope === null) {
            cursorScope = outerScope;
            self.postMessage({log: "Local scope is global scope."});
        }
        
        return cursorScope;
    }

//    function _filterByScope(scope) {
//        var allTokens = ast.tokens,
//            token,
//            uniqueTokens,
//            matchingTokens = [];
//        
//        uniqueTokens = allTokens.reduce(function (prev, curr) {
//            if (scope.contains(curr.value) >= 0) {
//                prev[curr.value] = curr;
//            }
//            return prev;
//        }, {});
//        
//        for (token in uniqueTokens) {
//            if (Object.prototype.hasOwnProperty.call(uniqueTokens, token)) {
//                matchingTokens.push(token);
//            }
//        }
//        
//        self.postMessage({log: "Tokens in scope: " + matchingTokens.length});
//        // TODO: sort tokens by scope + distance from offset
//        
//        return matchingTokens;
//    }
//    
//    function query(offset) {
//        if (ast) {
//            // either parsing succeeded, or it failed but the file is the same
//            if (!(localScope && localScope.range.start <= offset &&
//                offset < localScope.range.end)) {
//                self.postMessage({log: "Computing local scope for offset: " + offset});
//                localScope = _getScope(offset);
//                localTokens = _filterByScope(localScope);
//            }
//            return localTokens;
//        } else {
//            return null;
//        }
//    }
    
    self.addEventListener("message", function (e) {
        var request = e.data,
            type = request.type;
        
        if (type === "innerScope") {
            var newpath = request.path,
                offset  = request.offset,
                result  = {
                    type    : type,
                    path    : newpath,
                    offset  : offset
                };
            
            var outerScope = request.scope;
            var innerScope = findChildScope(outerScope, offset);
            result.scope = innerScope;
            if (innerScope) {
                result.tokens = getAllIdentifiersInScope(innerScope).map(function (t) { return t.name; });
            } else {
                result.tokens = null;
            }
            result.success = !!result.tokens;
            self.postMessage(result);
        } else {
            self.postMessage({
                log : "Unknown message: " + JSON.stringify(e.data)
            });
        }
    });
}());