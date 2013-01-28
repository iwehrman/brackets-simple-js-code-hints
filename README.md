Brackets JavaScript Code Hints
==============================

An extension for the [Brackets](http://brackets.io) text editor that provides 
code hints (aka *autocompletion*) for the JavaScript programming language.
Hints are provided for variables (including globals), function parameters, 
properties and keywords. The results are sorted and filtered according to 
lexical scope, positions of occurrences, and other heuristics. The extension
relies on [Esprima](http://esprima.org) for JavaScript parsing.

Here's what it looks like:

![JS hint screenshot](http://f.cl.ly/items/3W2u2C3w0k2O1y1o1u3z/Screen%20Shot%202013-01-11%20at%206.30.51%20PM.png "JS hint screenshot")

To install, clone the repository into the src/extensions/dev directory, run 
`git submodule init` and `git submodule update`, and then restart Brackets.