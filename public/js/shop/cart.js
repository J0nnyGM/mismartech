import { db, doc, onSnapshot } from "../firebase-init.js";
import { SmartCache } from "./cache-service.js";

// ✅ UNIFICACIÓN DE LLAVE: Totalmente integrado al ecosistema Smartech
const CART_KEY = 'smartech_cart';

let cartUnsubscribers = {}; 

/* ==========================================================================
   🎨 MAPA DE COLORES EXPORTABLE (Sincronizado con app.js)
   ========================================================================== */
export const colorMap = {
    "negro": "#171717", "black": "#171717", "blanco": "#F9FAFB", "white": "#F9FAFB",
    "azul": "#2563EB", "blue": "#2563EB", "rojo": "#DC2626", "red": "#DC2626",
    "verde": "#16A34A", "green": "#16A34A", "gris": "#4B5563", "gray": "#4B5563",
    "plateado": "#E5E7EB", "silver": "#E5E7EB", "dorado": "#FCD34D", "gold": "#FCD34D",
    "morado": "#9333EA", "purple": "#9333EA", "rosa": "#EC4899", "pink": "#EC4899",
    "titanio": "#9CA3AF", "natural": "#D4D4D8"
};

export function getColorHex(name) {
    if (!name) return '#E5E7EB';
    if (name.startsWith('#')) return name; 
    if (/^[0-9A-Fa-f]{6}$/i.test(name)) return `#${name}`; 
    return colorMap[name.toLowerCase()] || name; 
}

/* ==========================================================================
   MÓDULO CORE: OPERACIONES DEL CARRITO
   ========================================================================== */

export function getCart() {
    const cart = localStorage.getItem(CART_KEY);
    return cart ? JSON.parse(cart) : [];
}

function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('cartUpdated')); 
    updateCartCount();
    startCartSync(); 
}

export function addToCart(product) {
    const cart = getCart();
    const pColor = product.color || null;
    const pCapacity = product.capacity || null;
    
    // Resolve dynamic maxStock from passed object, check SmartCache, fallback to 999
    let maxStock = product.maxStock;
    if (maxStock === undefined) {
        if (product.stock !== undefined) {
            maxStock = product.stock;
        } else {
            const cachedProd = SmartCache.getProduct(product.id);
            if (cachedProd) {
                if (cachedProd.combinations && cachedProd.combinations.length > 0) {
                    const combo = cachedProd.combinations.find(c => 
                        (c.color === pColor || (!c.color && !pColor)) &&
                        (c.capacity === pCapacity || (!c.capacity && !pCapacity))
                    );
                    if (combo && combo.stock !== undefined) {
                        maxStock = combo.stock;
                    } else {
                        maxStock = cachedProd.stock !== undefined ? cachedProd.stock : 999;
                    }
                } else {
                    maxStock = cachedProd.stock !== undefined ? cachedProd.stock : 999;
                }
            } else {
                maxStock = 999;
            }
        }
    }
    const isCartPreviouslyEmpty = cart.length === 0;

    const uniqueCartId = `${product.id}-${pColor || 'def'}-${pCapacity || 'def'}`;
    const existingItem = cart.find(item => item.cartId === uniqueCartId);

    let newQty = product.quantity || 1;
    let isNewItem = false; 

    if (existingItem) {
        newQty += existingItem.quantity;
        if (newQty > maxStock) {
            if (window.showToast) {
                window.showToast(`Solo hay ${maxStock} unidades disponibles en inventario.`, "error");
            }
            return { success: false, message: `Solo hay ${maxStock} unidades disponibles.` };
        }
        existingItem.quantity = newQty;
    } else {
        if (newQty > maxStock) {
            if (window.showToast) {
                window.showToast(`Solo hay ${maxStock} unidades disponibles en inventario.`, "error");
            }
            return { success: false, message: `Solo hay ${maxStock} unidades disponibles.` };
        }
        isNewItem = true; 
        cart.push({
            cartId: uniqueCartId,
            id: product.id,
            name: product.name,
            price: Math.round(Number(product.price)) || 0,
            originalPrice: Math.round(Number(product.originalPrice)) || 0,
            image: product.mainImage || product.image || 'https://placehold.co/100',
            color: pColor,       
            capacity: pCapacity, 
            quantity: newQty,
            maxStock: maxStock
        });
    }

    saveCart(cart);
    if (isNewItem) {
        window.dispatchEvent(new CustomEvent('cartItemAdded', { 
            detail: { isFirstProduct: isCartPreviouslyEmpty } 
        }));
    }
    return { success: true };
}

export function updateQuantity(cartId, newQty) {
    let cart = getCart();
    const item = cart.find(i => i.cartId === cartId);

    if (item) {
        const qty = parseInt(newQty);
        
        // Resolve fresh maxStock from SmartCache
        let max = item.maxStock;
        const cachedProd = SmartCache.getProduct(item.id);
        if (cachedProd) {
            if (cachedProd.combinations && cachedProd.combinations.length > 0) {
                const combo = cachedProd.combinations.find(c => 
                    (c.color === item.color || (!c.color && !item.color)) &&
                    (c.capacity === item.capacity || (!c.capacity && !item.capacity))
                );
                if (combo && combo.stock !== undefined) {
                    max = combo.stock;
                } else {
                    max = cachedProd.stock !== undefined ? cachedProd.stock : max;
                }
            } else {
                max = cachedProd.stock !== undefined ? cachedProd.stock : max;
            }
        }
        if (max === undefined) max = 999;
        
        if (qty > max) {
            if (window.showToast) {
                window.showToast(`Solo hay ${max} unidades disponibles en inventario.`, "error");
            }
            return { success: false, message: `Máximo ${max} unidades.` };
        }
        if (qty <= 0) {
            cart = cart.filter(i => i.cartId !== cartId);
        } else {
            item.quantity = qty;
        }
        saveCart(cart);
        return { success: true };
    }
    return { success: false, message: "Producto no encontrado" };
}

export function removeFromCart(cartId) {
    let cart = getCart();
    cart = cart.filter(item => item.cartId !== cartId);
    saveCart(cart);
}

export function removeOneUnit(productId) {
    let cart = getCart();
    const index = cart.findIndex(item => item.id === productId);
    
    if (index !== -1) {
        if (cart[index].quantity > 1) {
            cart[index].quantity -= 1;
        } else {
            cart.splice(index, 1);
        }
        saveCart(cart);
    }
}

export function getCartTotal() {
    const cart = getCart();
    return cart.reduce((total, item) => {
        if (item.maxStock !== undefined && item.maxStock <= 0) {
            return total; 
        }
        return total + (item.price * item.quantity);
    }, 0);
}

export function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    
    const badges = document.querySelectorAll('#cart-count-desktop, #cart-count-mobile');
    badges.forEach(badge => {
        badge.textContent = count;
        if(count > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    });
}

export function getProductQtyInCart(productId) {
    const cart = getCart();
    return cart
        .filter(item => item.id === productId)
        .reduce((sum, item) => sum + (item.quantity || 0), 0);
}

/* ==========================================================================
   🧠 MOTOR DE SINCRONIZACIÓN EN TIEMPO REAL DEL CARRITO (FIRESTORE CLOUD)
   ========================================================================== */
export function startCartSync() {
    const cart = getCart();
    const productIdsInCart = [...new Set(cart.map(i => i.id))];
    
    Object.keys(cartUnsubscribers).forEach(id => {
        if (!productIdsInCart.includes(id)) {
            cartUnsubscribers[id](); 
            delete cartUnsubscribers[id];
        }
    });
    
    productIdsInCart.forEach(productId => {
        if (!cartUnsubscribers[productId]) {
            cartUnsubscribers[productId] = onSnapshot(doc(db, "products", productId), (snap) => {
                if (snap.exists()) {
                    updateCartItemsFromCloud(productId, snap.data());
                } else {
                    updateCartItemsFromCloud(productId, { stock: 0, status: 'inactive' });
                }
            }, (error) => {
                console.error(`Error vigilando producto ${productId}:`, error);
            });
        }
    });
}

function updateCartItemsFromCloud(productId, pData) {
    let cart = getCart();
    let hasChanges = false;
    
    cart.forEach(item => {
        if (item.id === productId) {
            let newPrice = pData.price || 0;
            let newOriginalPrice = pData.originalPrice || 0;
            let newStock = pData.stock || 0;
            const isInactive = pData.status !== 'active';
            
            if (isInactive) {
                newStock = 0;
            } 
            else if (pData.combinations && pData.combinations.length > 0) {
                const combo = pData.combinations.find(c => 
                    (c.color === item.color || (!c.color && !item.color)) &&
                    (c.capacity === item.capacity || (!c.capacity && !item.capacity))
                );
                if (combo) {
                    newPrice = combo.price;
                    newOriginalPrice = combo.originalPrice || 0;
                    newStock = combo.stock;
                } else {
                    newStock = 0; 
                }
            } 
            else if (item.capacity && pData.capacities) {
                const cap = pData.capacities.find(c => c.label === item.capacity);
                if (cap) {
                    newPrice = cap.price;
                    newOriginalPrice = cap.originalPrice || 0;
                }
            }

            if (item.price !== newPrice || item.originalPrice !== newOriginalPrice || item.maxStock !== newStock || item.name !== pData.name) {
                item.price = newPrice;
                item.originalPrice = newOriginalPrice;
                item.maxStock = newStock;
                item.name = pData.name || item.name;
                
                if (newStock > 0 && item.quantity > newStock) {
                    item.quantity = newStock;
                }
                hasChanges = true;
            }
        }
    });
    
    if (hasChanges) {
        console.log(`🛒 [Cart Sync] Sincronización en vivo completada para ${productId}.`);
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
        window.dispatchEvent(new Event('cartUpdated')); 
        updateCartCount();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCartSync);
} else {
    startCartSync();
}