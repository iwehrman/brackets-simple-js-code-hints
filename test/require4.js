define(["my/cart", "my/inventory"],
    function(cart, inventory) {
        
        
        return function(title) {
            return title ? (window.title = title) :
                   inventory.storeName + ' ' + cart.name;
        }
    }
);