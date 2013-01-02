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
/*global define */


define(function (require, exports, module) {
    "use strict";
    
    function _buildScope(tree, parent) {
        var child;
    
        if (tree === undefined || tree === null) {
            return;
        }
    
        switch (tree.type) {
        case "Program":
            tree.body.forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "FunctionDeclaration":
            parent.add(tree.id);
            child = parent._addChild(tree);
            child.addAll(tree.params);
            _buildScope(tree.body, child);
            break;

        case "VariableDeclaration":
            // FIXME handle let scoping 
            tree.declarations.forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "VariableDeclarator":
            parent.add(tree.id);
            if (tree.init !== null) {
                _buildScope(tree.init, parent);
            }
            break;

        case "ExpressionStatement":
            _buildScope(tree.expression, parent);
            break;

        case "SwitchStatement":
            _buildScope(tree.discriminant, parent);
            if (tree.cases) {
                tree.cases.forEach(function (t) {
                    _buildScope(t, parent);
                });
            }
            break;

        case "SwitchCase":
            tree.consequent.forEach(function (t) {
                _buildScope(t, parent);
            });
            if (tree.test) {
                _buildScope(tree.test, parent);
            }
            break;

        case "BlockStatement":
            tree.body.forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "DebuggerStatement":
        case "EmptyStatement":
            break;

        case "TryStatement":
            tree.handlers.forEach(function (t) {
                _buildScope(t, parent);
            });
            _buildScope(tree.block, parent);
            if (tree.finalizer) {
                _buildScope(tree.finalizer, parent);
            }
            break;

        case "ThrowStatement":
            _buildScope(tree.argument, parent);
            break;

        case "WithStatement":
            [tree.object, tree.body].forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "CatchClause":
            if (tree.guard) {
                _buildScope(tree.guard, parent);
            }
            child = parent._addChild(tree);
            child.add(tree.param);
            _buildScope(tree.body, child); // FIXME not sure if this is correct...
            break;

        case "ReturnStatement":
            if (tree.argument) {
                _buildScope(tree.argument, parent);
            }
            break;

        case "ForStatement":
            _buildScope(tree.body, parent);
            if (tree.init) {
                _buildScope(tree.init, parent);
            }
            if (tree.test) {
                _buildScope(tree.test, parent);
            }
            if (tree.update) {
                _buildScope(tree.update, parent);
            }
            break;

        case "ForInStatement":
            [tree.left, tree.right, tree.body].forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "LabeledStatement":
            _buildScope(tree.body, parent);
            break;

        case "BreakStatement":
        case "ContinueStatement":
            if (tree.label) {
                _buildScope(tree.label, parent);
            }
            break;

        case "ThisExpression":
            break;

        case "UpdateExpression":
        case "UnaryExpression":
            _buildScope(tree.argument, parent);
            break;

        case "IfStatement":
        case "ConditionalExpression":
            if (tree.alternate) {
                [tree.test, tree.consequent, tree.alternate].forEach(function (t) {
                    _buildScope(t, parent);
                });
            } else {
                [tree.test, tree.consequent].forEach(function (t) {
                    _buildScope(t, parent);
                });
            }
            break;

        case "WhileStatement":
        case "DoWhileStatement":
            [tree.test, tree.body].forEach(function (t) {
                _buildScope(t, parent);
            });
            break;


        case "SequenceExpression":
            tree.expressions.forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "ObjectExpression":
            tree.properties.forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "ArrayExpression":
            tree.elements.forEach(function (t) {
                _buildScope(t, parent);
            });
            break;
            
        case "NewExpression":
            if (tree.arguments) {
                tree.arguments.forEach(function (t) {
                    _buildScope(t, parent);
                });
            }
            _buildScope(tree.callee, parent);
            break;

        case "BinaryExpression":
        case "AssignmentExpression":
        case "LogicalExpression":
            [tree.left, tree.right].forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "MemberExpression":
            [tree.object, tree.property].forEach(function (t) {
                _buildScope(t, parent);
            });
            break;

        case "CallExpression":
            tree.arguments.forEach(function (t) {
                _buildScope(t, parent);
            });
            _buildScope(tree.callee, parent);
            break;
            
        case "FunctionExpression":
            if (tree.id) {
                parent.add(tree.id);
            }
            child = parent._addChild(tree);
            child.addAll(tree.params);
            _buildScope(tree.body, child);
            break;

        case "Property":
            // undocumented? 
            _buildScope(tree.value, parent);
            break;

        case "Identifier":
        case "Literal":
            break;

        default:
            throw "Unknown node type: " + tree.type;
        }
    }
    
    function Scope(tree, parent) {
    
        this.identifiers = [];
        this.children = []; // disjoint ranges, ordered by range start
        this.range = { start: tree.range[0], end: tree.range[1] };
    
        // if parent is null, walk the AST 
        if (parent !== undefined && parent !== null) {
            this.parent = parent;
        } else {
            this.parent = null;
            _buildScope(tree, this);
        }
    }
    
    Scope.prototype.add = function (id) {
        this.identifiers.push(id);
    };
    
    Scope.prototype.addAll = function (ids) {
        var that = this;
        ids.forEach(function (i) {
            that.identifiers.push(i);
        });
    };
    
    Scope.prototype._addChild = function (tree) {
        var child = new Scope(tree, this), i = 0;
        
        for (; i < this.children.length &&
            child.range.start > this.children[i].range.end; i++);
        this.children.splice(i, 0, child);
        return child; 
    };
    
    Scope.prototype.findChild = function (pos) {
        if (this.range.start <= pos && pos < this.range.end) {
            for (var i = 0; i < this.children.length; i++) {
                if (this.children[i].range.start <= pos && pos < this.children[i].range.end) {
                    return this.children[i].findChild(pos);
                }
            }
            // if no child has a matching range, this is the most precise scope
            return this; 
        } else {
            return null; 
        }
    }
    
    Scope.prototype.member = function (sym) {
        for (var i = 0; i < this.identifiers.length; i++) {
            if (this.identifiers[i].name === sym) {
                return true;
            }
        }
        return false;
    }
    
    Scope.prototype.contains = function (sym) {
        var depth = 0;
        var child = this; 
        do {
            if (child.member(sym)) {
                return depth;
            } else {
                child = child.parent;
                depth++;
            }
        } while (child != null);
        return undefined;
    }
    
    Scope.prototype.getAllIdentifiers = function () {
        var ids = [];
        var scope = this; 
        do {
            ids = ids.concat(this.identifiers);
            scope = scope.parent;
        } while (scope != null);
        return ids;
    }

    Scope.prototype.toStringBelow = function() {
        return "[" + this.range.start + " " + this.identifiers.map(function (i) { 
                        return i.name; }).join(", ") + 
                " : " + (this.children.map(function (c) { 
                        return c.toString() }).join("; ")) + 
                this.range.end + "]";
    }
     
    Scope.prototype.toString = function() {
        return "[" + this.range.start + " " + this.identifiers.map(function (i) { 
                        return i.name; }).join(", ") + 
                this.range.end + "]";
    }

    exports.Scope = Scope; 
});