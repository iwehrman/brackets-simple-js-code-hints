Brackets JavaScript Code Hints
==============================

An experimental extension for the [Brackets](http://brackets.io) text editor that provides code hints (aka *autocompletion*) for the JavaScript programming language. Hints are provided for variables, function parameters and properties, and are sorted and filtered according to lexical scope and the positions of occurrences in the current file. 
The extension relies on [Esprima](http://esprima.org) for JavaScript parsing.

To install, clone the repository into the src/extensions/dev directory, run `git submodule init` and `git submodule update`, and then restart Brackets.