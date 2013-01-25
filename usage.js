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
/*global define, brackets, $, setTimeout */

define(function (require, exports, module) {
    "use strict";

    var PreferencesManager = brackets.getModule("preferences/PreferencesManager");
    
    require("Math.uuid");
    
    var SERVER_URL      = "http://localhost:8080/a",
        PREFERENCES_KEY = "brackets-js-hints",
        CLIENT_ID_KEY   = "client-id";

    function listen(obj) {

        function save(obj) {

            var response = JSON.stringify(obj);
            console.log("Response: " + response);
            
            $.ajax({
                type    : "POST",
                url     : SERVER_URL,
                data    : { s: response }
            }).fail(function (jqXhr, msg, err) {
                console.log("Error: " + msg);
            });
        }

        Array.prototype.last = function () {
            return this[this.length - 1];
        };

        var session         = null,
            keystrokes      = 0,
            sessioncount    = 0,
            hints           = null,
            type            = null,
            prefs           = PreferencesManager.getPreferenceStorage(PREFERENCES_KEY),
            userId          = prefs.getValue(CLIENT_ID_KEY);
        
        if (!userId) {
            userId = Math.uuidFast();
            prefs.setValue(CLIENT_ID_KEY, userId);
        }

        function makeSession(key) {
            return {
                userid       : userId,
                sessioncount : sessioncount++,
                keycount     : keystrokes,
                startkey     : key,
                property     : undefined,
                finished     : false,
                succeeded    : undefined,
                responses    : []
            };
        }
        
        function endSession(hints, completion) {
            
            // sessions should be finished on save
            console.assert(session.finished);
            delete session.finished;
            session.property = type.property;
            
            session.responses.forEach(function (resp) {
                if (!resp.deferred) {
                    // recalculate the current hint list
                    var list = hints.filter(function (t) {
                        return (t.value.indexOf(resp.query) >= 0);
                    }),
                        current = 0,
                        target = -1;
                    
                    // find the position of the completion in the hint list
                    for (current; current < list.length; current++) {
                        if (list[current].value === completion) {
                            target = current;
                            break;
                        }
                    }
                    resp.position = target;
                    resp.length = list.length;
                }
                delete resp.query;
            });
            
            save(session);
            session = null;
        }

        $(obj).on("hasHints", function (event) {
            if (session && !session.finished) {
                session.succeeded = false;
                session.finished = true;
                endSession(hints);
            }

            keystrokes++;
        }).on("beginHintSession", function (event, key) {
            keystrokes++;
            session = makeSession(key);
        }).on("refreshHints", function (event, key, newhints, newtype) {
            if (session.responses.length > 0) {
                // a new session has implicitly begun, so end the existing one
                // and restart
                session.succeeded = false;
                session.finished = true;
                endSession(hints);

                session = makeSession(key);
            }
    
            hints = newhints;
            type = newtype;
        }).on("hintResponse", function (event, query) {
            session.responses.push({
                deferred    : false,
                query       : query
            });
        }).on("deferredResponse", function (event) {
            session.responses.push({
                deferred    : true
            });
        }).on("nullResponse", function (event) {
            session.succeeded = false;
            session.finished = true;
            endSession(hints);
        }).on("insertHint", function (event, hint) {
            session.succeeded = true;
            session.finished = true;
            endSession(hints, hint);
        });
    }

    exports.listen = listen;
});
