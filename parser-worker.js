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
/*global self, importScripts, esprima */

(function () {
    'use strict';

    importScripts('esprima/esprima.js', 'scope.js');

    function _log(msg) {
        self.postMessage({log: msg });
    }
    
    /**
     * Walk the scope to find all the objects of a given type, along with a
     * list of their positions in the file.
     */
    function sift(scope, type) {
        var positions,
            results = [],
            token,
            key,
            i;
        
        positions = scope.walkDown(function (acc, token) {
            if (Object.prototype.hasOwnProperty.call(acc, token.name)) {
                acc[token.name].push(token.range[0]);
            } else {
                acc[token.name] = [token.range[0]];
            }
            return acc;
        }, {}, type);
        
        for (key in positions) {
            if (Object.prototype.hasOwnProperty.call(positions, key)) {
                token = {
                    value: key,
                    positions: positions[key]
                };
                results.push(token);
            }
        }
        return results;
    }
    
    /**
     * Use Esprima to parse a JavaScript text
     */
    function parse(text) {
        try {
            var ast = esprima.parse(text, {
                range       : true,
                tolerant    : true
            });
            if (ast.errors.length > 0) {
                _log("Parse errors: " + JSON.stringify(ast.errors));
            }
            return new self.Scope(ast);
        } catch (err) {
            // _log("Parsing failed: " + err);
            return null;
        }
    }
    
    self.addEventListener("message", function (e) {
        var request = e.data,
            type = request.type;

        if (type === "outerScope") {
            var text    = request.text,
                newpath = request.path,
                scope = parse(text),
                identifiers = scope ? sift(scope, 'identifiers') : null,
                properties = scope ? sift(scope, 'properties') : null,
                respose  = {
                    type        : type,
                    path        : newpath,
                    scope       : scope,
                    identifiers : identifiers,
                    properties  : properties,
                    success     : !!scope
                };
            
            self.postMessage(respose);
        } else {
            _log("Unknown message: " + JSON.stringify(e.data));
        }
    });
}());

/*
 * Used by the Web Worker-specific importScripts operation
 */
function define(f) {
    'use strict';
    f(null, self, null);
}
