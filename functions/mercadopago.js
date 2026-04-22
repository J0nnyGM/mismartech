const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");

// --- CONFIGURACIÓN ---
// Asegúrate de tener esto en tu archivo .env
const MP_TOKEN = process.env.MP_ACCESS_TOKEN;
const client = MP_TOKEN ? new MercadoPagoConfig({ accessToken: MP_TOKEN }) : null;

// CAMBIA ESTO POR TU URL REAL DE FIREBASE FUNCTIONS
const WEBHOOK_URL = "https://us-central1-pixeltechcol.cloudfunctions.net/mercadoPagoWebhook"; 

/**
 * 1. CREAR PREFERENCIA (CHECKOUT)
 * - Crea la orden en Firebase como PENDIENTE_PAGO.
 * - Genera el link de MercadoPago con expiración de 30 minutos.
 */
exports.createPreference = async (data, context) => {
    // Inicialización Lazy
    const db = admin.firestore();
    const auth = admin.auth();

    console.log("🚀 Iniciando Checkout MP...");

    if (!client) throw new functions.https.HttpsError('internal', 'Pasarela no configurada.');

    // --- 1. AUTENTICACIÓN ---
    const userToken = data.userToken || (data.data && data.data.userToken);
    let uid, email;

    try {
        if (userToken) {
            const decodedToken = await auth.verifyIdToken(userToken);
            uid = decodedToken.uid;
            email = decodedToken.email;
        } else if (context.auth) {
            uid = context.auth.uid;
            email = context.auth.token.email;
        } else {
            throw new Error("Sin credenciales.");
        }
    } catch (error) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión para comprar.');
    }

    // --- 2. VALIDAR DATOS ---
    const rawItems = data.items || (data.data && data.data.items);
    const shippingCost = Number(data.shippingCost || (data.data && data.data.shippingCost) || 0);
    const buyerInfo = data.buyerInfo || (data.data && data.data.buyerInfo) || {};
    const extraData = data.extraData || (data.data && data.data.extraData) || {};

    if (!rawItems || !rawItems.length) throw new functions.https.HttpsError('invalid-argument', 'El carrito está vacío.');

    try {
        let mpItems = []; 
        let dbItems = []; 
        let subtotal = 0;
        
        // Validar precios reales en DB para seguridad
        for (const item of rawItems) {
            const pDoc = await db.collection('products').doc(item.id).get();
            if (!pDoc.exists) continue;
            
            const pData = pDoc.data();
            const realPrice = Number(pData.price) || 0;
            const quantity = parseInt(item.quantity) || 1;
            
            subtotal += realPrice * quantity;

            // Item para base de datos
            dbItems.push({
                id: item.id,
                name: pData.name, 
                price: realPrice,       
                quantity: quantity,
                color: item.color || "",       
                capacity: item.capacity || "", 
                mainImage: pData.mainImage || pData.image || ""
            });

            // Item para MercadoPago
            mpItems.push({
                id: item.id,
                title: pData.name,
                description: `${pData.name} ${item.color || ''} ${item.capacity || ''}`.trim(),
                quantity: quantity,
                unit_price: realPrice,
                currency_id: 'COP',
                picture_url: pData.mainImage || ''
            });
        }

        if (shippingCost > 0) {
            mpItems.push({
                id: 'envio', title: 'Costo de Envío', quantity: 1, unit_price: shippingCost, currency_id: 'COP'
            });
        }

        const totalAmount = subtotal + shippingCost;
        
        // --- 3. CREAR ORDEN EN FIREBASE ---
        const newOrderRef = db.collection('orders').doc();
        const shippingData = extraData.shippingData || { address: buyerInfo.address };

        await newOrderRef.set({
            source: 'TIENDA_WEB',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            userId: uid,
            userEmail: email,
            userName: extraData.userName || buyerInfo.name,
            phone: extraData.phone || buyerInfo.phone || "",
            clientDoc: extraData.clientDoc || "",
            
            shippingData: shippingData,
            billingData: extraData.billingData || null,
            requiresInvoice: extraData.needsInvoice || false,
            
            items: dbItems,
            subtotal: subtotal,
            shippingCost: shippingCost,
            total: totalAmount,
            
            status: 'PENDIENTE_PAGO',
            paymentMethod: 'MERCADOPAGO',
            paymentStatus: 'PENDING',
            isStockDeducted: false, // Se descuenta al pagar
            
            buyerInfo: buyerInfo 
        });

        // --- 4. CONFIGURAR EXPIRACIÓN (30 MINUTOS) ---
        const expirationDate = new Date();
        expirationDate.setMinutes(expirationDate.getMinutes() + 30);

        // --- 5. CREAR PREFERENCIA MP ---
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: mpItems,
                payer: {
                    name: buyerInfo.name,
                    email: email,
                    phone: { area_code: "57", number: buyerInfo.phone },
                    address: { street_name: buyerInfo.address, zip_code: buyerInfo.postal }
                },
                back_urls: {
                    success: "https://pixeltechcol.com/shop/success.html", 
                    failure: "https://pixeltechcol.com/shop/success.html", 
                    pending: "https://pixeltechcol.com/shop/success.html"
                },
                auto_return: "approved",
                statement_descriptor: "PIXELTECH",
                external_reference: newOrderRef.id,
                notification_url: WEBHOOK_URL,
                date_of_expiration: expirationDate.toISOString() // EXPIRACIÓN AUTOMÁTICA
            }
        });

        return { preferenceId: result.id, initPoint: result.init_point };

    } catch (error) {
        console.error("❌ Error MP Create:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
};

/**
 * 2. WEBHOOK (CONFIRMACIÓN DE PAGO)
 * - Recibe notificación de MP.
 * - Verifica estado real.
 * - Descuenta stock.
 * - Suma saldo a Tesorería.
 */
exports.webhook = async (req, res) => {
    const db = admin.firestore();
    
    try {
        if (!client) return res.status(500).send("No config");

        const paymentId = req.query.id || req.query['data.id'] || req.body?.data?.id || req.body?.id;
        const topic = req.query.topic || req.body?.topic;

        // Ignoramos notificaciones de orden comercial, solo nos importan los pagos
        if (topic === 'merchant_order') return res.status(200).send("OK");
        if (!paymentId) return res.status(200).send("OK");

        // Consultar estado real a la API de MP
        const payment = new Payment(client);
        let paymentData;
        try {
            paymentData = await payment.get({ id: paymentId });
        } catch (e) { 
            console.warn("Error leyendo pago MP:", e.message);
            return res.status(200).send("OK"); 
        }
        
        const status = paymentData.status; 
        const orderId = paymentData.external_reference;

        if (!orderId) return res.status(200).send("OK");
        
        const orderRef = db.collection('orders').doc(orderId);
        const remRef = db.collection('remissions').doc(orderId);

        // --- A. PAGO APROBADO ---
        if (status === 'approved') {
            await db.runTransaction(async (t) => {
                
                // ==========================================
                // FASE 1: LECTURAS (t.get)
                // ==========================================
                const docSnap = await t.get(orderRef);
                if (!docSnap.exists || docSnap.data().status === 'PAGADO' || docSnap.data().paymentStatus === 'PAID') return;
                
                const oData = docSnap.data();

                // Leer Inventario
                const prodReads = [];
                if(!oData.isStockDeducted) {
                    for(const i of oData.items) {
                        const pRef = db.collection('products').doc(i.id);
                        const pDoc = await t.get(pRef);
                        if(pDoc.exists) {
                            const pData = pDoc.data();
                            let newS = (pData.stock||0) - (i.quantity||1);
                            let newC = pData.combinations || [];
                            
                            if (i.color || i.capacity) {
                                if (newC.length > 0) {
                                    const idx = newC.findIndex(c => 
                                        (c.color === i.color || (!c.color && !i.color)) &&
                                        (c.capacity === i.capacity || (!c.capacity && !i.capacity))
                                    );
                                    if (idx >= 0) newC[idx].stock = Math.max(0, newC[idx].stock - i.quantity);
                                }
                            }
                            prodReads.push({ ref: pRef, stock: Math.max(0, newS), combos: newC });
                        }
                    }
                }

                // Leer Tesorería
                const accQ = await t.get(db.collection('accounts').where('gatewayLink', '==', 'MERCADOPAGO').limit(1));
                let accDoc = null;
                if(!accQ.empty) {
                    accDoc = accQ.docs[0];
                } else {
                    const nameQ = await t.get(db.collection('accounts').where('name', '==', 'MercadoPago').limit(1));
                    if(!nameQ.empty) accDoc = nameQ.docs[0];
                    else {
                        const defQ = await t.get(db.collection('accounts').where('isDefaultOnline', '==', true).limit(1));
                        if(!defQ.empty) accDoc = defQ.docs[0];
                    }
                }

                // Leer Remisión (BLINDAJE AGREGADO)
                const remSnap = await t.get(remRef);

                // ==========================================
                // FASE 2: ESCRITURAS (t.set, t.update)
                // ==========================================
                let accId = null, accName = 'MercadoPago';
                if(accDoc) {
                    t.update(accDoc.ref, { balance: (Number(accDoc.data().balance)||0) + (Number(oData.total)||0) });
                    
                    const incRef = db.collection('expenses').doc();
                    t.set(incRef, {
                        amount: Number(oData.total), 
                        category: "Ingreso Ventas Online",
                        description: `Venta MP #${orderId.slice(0,8)}`, 
                        paymentMethod: accDoc.data().name,
                        date: admin.firestore.FieldValue.serverTimestamp(), 
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        type: 'INCOME', 
                        orderId: orderId, 
                        supplierName: oData.userName
                    });
                    accId = accDoc.id; 
                    accName = accDoc.data().name;
                }

                for(const p of prodReads) {
                    t.update(p.ref, { stock: p.stock, combinations: p.combos });
                }
                
                // Escribir Remisión blindada
                if (!remSnap.exists) {
                    t.set(remRef, {
                        orderId, source: 'WEBHOOK_MP', items: oData.items,
                        clientName: oData.userName, clientPhone: oData.phone, clientDoc: oData.clientDoc,
                        clientAddress: `${oData.shippingData?.address}, ${oData.shippingData?.city}`,
                        total: oData.total, status: 'PENDIENTE_ALISTAMIENTO', type: 'VENTA_WEB',
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                t.update(orderRef, {
                    status: 'PAGADO', 
                    paymentStatus: 'PAID', 
                    paymentId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    isStockDeducted: true, 
                    paymentAccountId: accId, 
                    paymentMethodName: accName
                });
            });
            console.log("✅ MP Order Approved:", orderId);
        } 
        
        // --- B. PAGO RECHAZADO / CANCELADO ---
        else if (status === 'rejected' || status === 'cancelled') {
            const docCheck = await orderRef.get();
            if (docCheck.exists && docCheck.data().paymentStatus !== 'PAID') {
                await orderRef.update({
                    status: 'RECHAZADO', 
                    paymentId, 
                    statusDetail: paymentData.status_detail,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log("❌ MP Order Rejected:", orderId);
            }
        }
        
        res.status(200).send("OK");

    } catch (e) {
        console.error("❌ MP Webhook Error:", e);
        res.status(500).send("Err");
    }
};