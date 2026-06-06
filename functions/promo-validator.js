const admin = require("firebase-admin");

// Helper to safely parse Firebase/Firestore prices to real numbers
function parsePrice(val) {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const cleaned = val.replace(/[^0-9]/g, '');
        return Number(cleaned) || 0;
    }
    return 0;
}

/**
 * Validates a list of promo codes / gift cards and calculates subtotals and discounts securely.
 * 
 * @param {Array} items - Array of items from client { id, quantity, color, capacity }
 * @param {Array} promoCodes - Array of string promo codes (e.g. ["PROMO10", "FREESHIP", "GC-XXXX"])
 * @param {Number} shippingCost - Original shipping cost calculated by client
 * @param {String} userId - The client user ID (to check per-user limits)
 * @param {String} paymentMethod - Selected payment method (e.g. 'MANUAL', 'COD', 'ADDI', 'SISTECREDITO', 'ONLINE')
 * @returns {Object} { subtotal, totalDiscounts, finalShippingCost, totalAmount, dbItems, appliedPromos }
 */
async function validateAndApplyDiscounts(items, promoCodes, shippingCost, userId, paymentMethod) {
    const db = admin.firestore();
    
    // 1. Load actual prices of products from DB to avoid price tampering
    let subtotal = 0;
    let dbItems = [];
    
    for (const item of items) {
        const pDoc = await db.collection('products').doc(item.id).get();
        if (!pDoc.exists) {
            throw new Error(`El producto con ID ${item.id} no existe.`);
        }
        
        const pData = pDoc.data();
        let realPrice = parsePrice(pData.price);
        let realOriginalPrice = parsePrice(pData.originalPrice || pData.price);
        
        // Resolve combinations if product has color/capacity combinations
        if (pData.combinations && pData.combinations.length > 0) {
            const combo = pData.combinations.find(c => {
                const cColor = (c.color || "").trim().toLowerCase();
                const itemColor = (item.color || "").trim().toLowerCase();
                const cCapacity = (c.capacity || "").trim().toLowerCase();
                const itemCapacity = (item.capacity || "").trim().toLowerCase();
                return cColor === itemColor && cCapacity === itemCapacity;
            });
            if (combo) {
                realPrice = parsePrice(combo.price);
                realOriginalPrice = parsePrice(combo.originalPrice || combo.price);
            }
        } else if (item.capacity && pData.capacities) {
            const cap = pData.capacities.find(c => {
                const cLabel = (c.label || "").trim().toLowerCase();
                const itemCapacity = (item.capacity || "").trim().toLowerCase();
                return cLabel === itemCapacity;
            });
            if (cap) {
                realPrice = parsePrice(cap.price);
                realOriginalPrice = parsePrice(cap.originalPrice || cap.price);
            }
        }

        // Safeguard fallback: if price is still 0 but product has options, use cheapest valid option
        if (realPrice === 0) {
            let allPrices = [];
            if (pData.combinations && Array.isArray(pData.combinations)) {
                allPrices.push(...pData.combinations.map(c => parsePrice(c.price)));
            }
            if (pData.capacities && Array.isArray(pData.capacities)) {
                allPrices.push(...pData.capacities.map(c => parsePrice(c.price)));
            }
            const validPrices = allPrices.filter(v => v > 0);
            if (validPrices.length > 0) {
                realPrice = Math.min(...validPrices);
                realOriginalPrice = realPrice;
            }
        }
        
        const quantity = parseInt(item.quantity) || 1;
        subtotal += realPrice * quantity;
        
        dbItems.push({
            id: item.id,
            name: pData.name,
            price: realPrice,
            originalPrice: realOriginalPrice || realPrice,
            quantity: quantity,
            color: item.color || "",
            capacity: item.capacity || "",
            brand: pData.brand || "Smartech",
            category: pData.category || "General",
            mainImage: pData.mainImage || pData.image || ""
        });
    }
    
    // 2. Validate Promo Codes and Gift Cards
    let appliedPromos = [];
    let stackableGroups = new Set();
    
    const now = new Date();
    
    if (promoCodes && promoCodes.length > 0) {
        // Unique clean codes
        const uniqueCodes = [...new Set(promoCodes.map(c => c.trim().toUpperCase()))];
        
        if (uniqueCodes.length > 3) {
            throw new Error("No se permite acumular más de 3 cupones/tarjetas.");
        }
        
        // Pre-load all promo types to evaluate them separately
        const loadedPromos = [];
        for (const code of uniqueCodes) {
            // First check in promo_codes
            const promoSnap = await db.collection('promo_codes')
                .where('code', '==', code)
                .limit(1)
                .get();
                
            if (!promoSnap.empty) {
                loadedPromos.push({
                    id: promoSnap.docs[0].id,
                    code: code,
                    data: promoSnap.docs[0].data(),
                    isGiftCard: false
                });
            } else {
                // If not found, check in gift_cards
                const gcSnap = await db.collection('gift_cards')
                    .where('code', '==', code)
                    .limit(1)
                    .get();
                
                if (!gcSnap.empty) {
                    loadedPromos.push({
                        id: gcSnap.docs[0].id,
                        code: code,
                        data: gcSnap.docs[0].data(),
                        isGiftCard: true
                    });
                } else {
                    throw new Error(`El código "${code}" no es válido.`);
                }
            }
        }
        
        const coupons = loadedPromos.filter(p => !p.isGiftCard);
        const giftCards = loadedPromos.filter(p => p.isGiftCard);
        
        // A. Validate coupons
        for (const p of coupons) {
            const promoData = p.data;
            const code = p.code;
            
            // Check status
            if (promoData.status !== 'active') {
                throw new Error(`El código "${code}" ya no está activo.`);
            }
            
            // Check dates
            if (promoData.startDate) {
                const start = promoData.startDate.toDate ? promoData.startDate.toDate() : new Date(promoData.startDate);
                if (now < start) {
                    throw new Error(`El código "${code}" aún no ha comenzado.`);
                }
            }
            if (promoData.endDate) {
                const end = promoData.endDate.toDate ? promoData.endDate.toDate() : new Date(promoData.endDate);
                if (now > end) {
                    throw new Error(`El código "${code}" ha expirado.`);
                }
            }
            
            // Check global usage limit
            if (promoData.usageLimit && (promoData.usageCount || 0) >= promoData.usageLimit) {
                throw new Error(`El código "${code}" ha alcanzado su límite de usos.`);
            }
            
            // Check per-user limit
            if (userId && promoData.perUserLimit) {
                const usageId = `${userId}_${p.id}`;
                const usageDoc = await db.collection('promo_usages').doc(usageId).get();
                if (usageDoc.exists) {
                    const usageCount = usageDoc.data().count || 0;
                    if (usageCount >= promoData.perUserLimit) {
                        throw new Error(`Has alcanzado el límite de usos permitidos para el código "${code}".`);
                    }
                }
            }
            
            // Check min order value
            if (promoData.minOrderValue && subtotal < promoData.minOrderValue) {
                throw new Error(`El código "${code}" requiere una compra mínima de $${promoData.minOrderValue.toLocaleString('es-CO')}.`);
            }
            
            // Check product restrictions
            if (promoData.applicableProducts && promoData.applicableProducts.length > 0) {
                const matchesProduct = dbItems.some(i => promoData.applicableProducts.includes(i.id));
                if (!matchesProduct) {
                    throw new Error(`El código "${code}" no aplica para los productos en tu carrito.`);
                }
            }
            
            // Check brand restrictions
            if (promoData.applicableBrands && promoData.applicableBrands.length > 0) {
                const normalizedBrands = promoData.applicableBrands.map(b => b.trim().toLowerCase());
                const matchesBrand = dbItems.some(i => normalizedBrands.includes((i.brand || "").trim().toLowerCase()));
                if (!matchesBrand) {
                    throw new Error(`El código "${code}" no aplica para las marcas en tu carrito.`);
                }
            }

            // Check category restrictions
            if (promoData.applicableCategories && promoData.applicableCategories.length > 0) {
                const normalizedCats = promoData.applicableCategories.map(c => c.trim().toLowerCase());
                const matchesCat = dbItems.some(i => normalizedCats.includes((i.category || "").trim().toLowerCase()));
                if (!matchesCat) {
                    throw new Error(`El código "${code}" no aplica para las categorías de tu carrito.`);
                }
            }

            // Check payment method restrictions
            if (promoData.applicablePaymentMethods && promoData.applicablePaymentMethods.length > 0) {
                if (paymentMethod) {
                    const normalizedMethods = promoData.applicablePaymentMethods.map(m => m.trim().toUpperCase());
                    if (!normalizedMethods.includes(paymentMethod.trim().toUpperCase())) {
                        throw new Error(`El código "${code}" no está disponible para el método de pago seleccionado.`);
                    }
                }
            }
            
            // Check stacking rules (only between coupons, gift cards are excluded from coupon collisions)
            if (coupons.length > 1) {
                if (promoData.isStackable !== true) {
                    throw new Error(`El código "${code}" no se puede combinar con otros cupones.`);
                }
                const group = promoData.stackableGroup || "general";
                if (stackableGroups.has(group)) {
                    throw new Error(`No puedes combinar múltiples cupones del tipo "${group}".`);
                }
                stackableGroups.add(group);
            }
            
            appliedPromos.push({
                id: p.id,
                code: code,
                type: promoData.type, // 'percentage' | 'fixed_amount' | 'free_shipping'
                value: Number(promoData.value) || 0,
                maxDiscount: Number(promoData.maxDiscount) || 0,
                stackableGroup: promoData.stackableGroup || "general"
            });
        }
        
        // B. Validate gift cards
        for (const p of giftCards) {
            const promoData = p.data;
            const code = p.code;
            
            // Check status
            if (promoData.status !== 'active') {
                throw new Error(`La tarjeta de regalo "${code}" ya no está activa.`);
            }
            
            // Check dates
            if (promoData.startDate) {
                const start = promoData.startDate.toDate ? promoData.startDate.toDate() : new Date(promoData.startDate);
                if (now < start) {
                    throw new Error(`La tarjeta de regalo "${code}" aún no está activa.`);
                }
            }
            if (promoData.endDate) {
                const end = promoData.endDate.toDate ? promoData.endDate.toDate() : new Date(promoData.endDate);
                if (now > end) {
                    throw new Error(`La tarjeta de regalo "${code}" ha expirado.`);
                }
            }
            
            const balance = Number(promoData.currentBalance) || 0;
            if (balance <= 0) {
                throw new Error(`La tarjeta de regalo "${code}" no tiene saldo disponible.`);
            }
            
            appliedPromos.push({
                id: p.id,
                code: code,
                type: 'gift_card',
                value: balance,
                deductedAmount: 0, // Will be computed during calculation
                stackableGroup: 'gift_card'
            });
        }
    }
    
    // 3. Mathematical execution of discounts in fixed deterministic order
    const percentagePromos = appliedPromos.filter(p => p.type === 'percentage');
    const fixedPromos = appliedPromos.filter(p => p.type === 'fixed_amount');
    const giftCardPromos = appliedPromos.filter(p => p.type === 'gift_card');
    const shippingPromos = appliedPromos.filter(p => p.type === 'free_shipping' || p.stackableGroup === 'shipping');
    
    let currentTotal = subtotal;
    let totalDiscounts = 0;
    
    // A. Apply percentage discounts
    for (const p of percentagePromos) {
        let discount = currentTotal * (p.value / 100);
        if (p.maxDiscount > 0 && discount > p.maxDiscount) {
            discount = p.maxDiscount;
        }
        totalDiscounts += discount;
        currentTotal -= discount;
    }
    
    // B. Apply fixed amount discounts
    for (const p of fixedPromos) {
        let discount = p.value;
        if (discount > currentTotal) {
            discount = currentTotal;
        }
        totalDiscounts += discount;
        currentTotal -= discount;
    }

    // C. Apply gift cards (subtracted from net total before shipping)
    for (const p of giftCardPromos) {
        let discount = Math.min(currentTotal, p.value);
        p.deductedAmount = discount;
        totalDiscounts += discount;
        currentTotal -= discount;
    }
    
    // D. Apply shipping discounts
    let finalShippingCost = shippingCost;
    if (shippingPromos.length > 0) {
        finalShippingCost = 0;
    }
    
    currentTotal = Math.max(0, currentTotal);
    const totalAmount = currentTotal + finalShippingCost;
    
    return {
        subtotal: subtotal,
        totalDiscounts: totalDiscounts,
        finalShippingCost: finalShippingCost,
        totalAmount: totalAmount,
        dbItems: dbItems,
        appliedPromos: appliedPromos
    };
}

/**
 * Increment usage count of the promo codes and deduct gift card balances transactionally.
 * Should be called inside a Firestore transaction.
 * 
 * @param {Transaction} transaction - Firestore transaction instance
 * @param {Array} appliedPromos - Validated promos array returned by validateAndApplyDiscounts
 * @param {String} userId - User ID
 * @param {String} orderId - Order ID
 * @param {String} userName - Client User Name
 */
async function registerPromoUsagesInTransaction(transaction, appliedPromos, userId, orderId = "unknown", userName = "") {
    const db = admin.firestore();
    
    for (const p of appliedPromos) {
        if (p.type === 'gift_card') {
            const cardRef = db.collection('gift_cards').doc(p.id);
            const cardSnap = await transaction.get(cardRef);
            
            if (cardSnap.exists) {
                const currentBalance = Number(cardSnap.data().currentBalance) || 0;
                const newBalance = Math.max(0, currentBalance - (p.deductedAmount || 0));
                const usages = cardSnap.data().usages || [];
                
                usages.push({
                    orderId: orderId,
                    userId: userId || "guest",
                    userName: userName || "Invitado",
                    amountDeducted: p.deductedAmount || 0,
                    timestamp: new Date()
                });
                
                transaction.update(cardRef, { 
                    currentBalance: newBalance,
                    status: newBalance === 0 ? 'redeemed' : 'active',
                    usages: usages,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        } else {
            const promoRef = db.collection('promo_codes').doc(p.id);
            const promoSnap = await transaction.get(promoRef);
            
            if (promoSnap.exists) {
                const currentCount = promoSnap.data().usageCount || 0;
                transaction.update(promoRef, { 
                    usageCount: currentCount + 1,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                
                if (userId) {
                    const usageId = `${userId}_${p.id}`;
                    const usageRef = db.collection('promo_usages').doc(usageId);
                    const usageSnap = await transaction.get(usageRef);
                    
                    if (usageSnap.exists) {
                        const currentUsage = usageSnap.data().count || 0;
                        transaction.update(usageRef, { 
                            count: currentUsage + 1,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    } else {
                        transaction.set(usageRef, {
                            userId: userId,
                            promoId: p.id,
                            code: p.code,
                            count: 1,
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                }
            }
        }
    }
}

async function validatePromoCodes(data, context) {
    try {
        // Soporta firmas de 1ra Generación (data) y de 2da Generación (data.data o CallableRequest)
        const rawData = (data && data.data) ? data.data : data;

        const items = (rawData && rawData.items) || [];
        const promoCodes = (rawData && rawData.promoCodes) || [];
        const shippingCost = Number((rawData && rawData.shippingCost) || 0);
        const userToken = rawData && rawData.userToken;
        const paymentMethod = rawData && rawData.paymentMethod;

        console.log("validatePromoCodes processed arguments:", JSON.stringify({
            itemsCount: items.length,
            promoCodes: promoCodes,
            shippingCost: shippingCost,
            hasUserToken: !!userToken,
            paymentMethod: paymentMethod
        }));
        
        let userId = null;
        if (userToken) {
            try {
                const decodedToken = await admin.auth().verifyIdToken(userToken);
                userId = decodedToken.uid;
            } catch (e) {
                // Token inválido/expirado
            }
        } else if (context && context.auth) {
            userId = context.auth.uid;
        } else if (data && data.auth) { // Contexto de autenticación en 2da Generación (request.auth)
            userId = data.auth.uid;
        }
        
        const result = await validateAndApplyDiscounts(items, promoCodes, shippingCost, userId, paymentMethod);
        return { success: true, ...result };
    } catch (e) {
        console.error("Error validating promo codes:", e);
        return { success: false, error: e.message };
    }
}

module.exports = {
    validateAndApplyDiscounts,
    registerPromoUsagesInTransaction,
    validatePromoCodes
};
