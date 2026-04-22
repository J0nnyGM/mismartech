const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require('cors')({ origin: true });

if (!admin.apps.length) {
    admin.initializeApp();
}

// ==========================================
// CONFIGURATION
// ==========================================
const IS_SANDBOX = false; 

const ADDI_BASE_URL = IS_SANDBOX
    ? "https://api.addi-staging.com"
    : "https://api.addi.com";

const ADDI_AUTH_URL = "https://auth.addi.com";
const ADDI_AUDIENCE = "https://api.addi.com";

const ADDI_CLIENT_ID = process.env.ADDI_CLIENT_ID;
const ADDI_CLIENT_SECRET = process.env.ADDI_CLIENT_SECRET;
const WEBHOOK_URL = "https://addiwebhook-muiondpggq-uc.a.run.app";

// ==========================================
// HELPER: GET TOKEN
// ==========================================
async function getAddiToken() {
    try {
        console.log(`🔐 Requesting Token (${IS_SANDBOX ? 'SANDBOX' : 'PROD'})...`);

        if (!ADDI_CLIENT_ID || !ADDI_CLIENT_SECRET) {
            throw new Error("ADDI credentials missing.");
        }

        const response = await axios({
            method: 'post',
            url: `${ADDI_AUTH_URL}/oauth/token`,
            data: {
                client_id: ADDI_CLIENT_ID.trim(),
                client_secret: ADDI_CLIENT_SECRET.trim(),
                audience: ADDI_AUDIENCE,
                grant_type: "client_credentials"
            },
            headers: { 'Content-Type': 'application/json' }
        });

        return response.data.access_token;
    } catch (error) {
        console.error("❌ Auth Error:", error.response?.data || error.message);
        throw new Error("Error autenticando con ADDI");
    }
}

// ==========================================
// 1. CREATE CHECKOUT
// ==========================================
exports.createAddiCheckout = async (data, context) => {
    const db = admin.firestore();
    const auth = admin.auth();

    console.log("🚀 Starting ADDI Checkout...");

    // 1. Validar Usuario
    const userToken = data.userToken || (data.data && data.data.userToken);
    let uid, email;
    try {
        if (userToken) {
            const decoded = await auth.verifyIdToken(userToken);
            uid = decoded.uid; email = decoded.email;
        } else if (context.auth) {
            uid = context.auth.uid; email = context.auth.token.email;
        } else {
            throw new Error("User auth failed");
        }
    } catch (e) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required.');
    }

    // 2. Procesar Datos de Entrada
    const rawItems = data.items || (data.data && data.data.items);
    const shippingCost = Number(data.shippingCost || (data.data && data.data.shippingCost) || 0);
    const extraData = data.extraData || (data.data && data.data.extraData) || {};
    const buyerInfo = data.buyerInfo || (data.data && data.data.buyerInfo) || {};
    const paymentMethod = data.paymentMethod || (data.data && data.data.paymentMethod) || 'ADDI';

    if (!rawItems || !rawItems.length) throw new functions.https.HttpsError('invalid-argument', 'Cart empty');

    // Construir Items y Totales
    let dbItems = [];
    let subtotal = 0;

    const removeAccents = (str) => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

    for (const item of rawItems) {
        const pDoc = await db.collection('products').doc(item.id).get();
        if (!pDoc.exists) continue;
        const pData = pDoc.data();
        const price = Number(pData.price) || 0;
        const qty = parseInt(item.quantity) || 1;
        subtotal += price * qty;

        dbItems.push({
            id: item.id,
            name: pData.name,
            price: price,
            quantity: qty,
            color: item.color || "",
            capacity: item.capacity || "",
            mainImage: pData.mainImage || pData.image || "https://pixeltechcol.com/img/logo.webp"
        });
    }

    const totalAmount = subtotal + shippingCost;

    // --- CORRECCIÓN DE DATOS PARA FIREBASE ---
    // Asegurar que shippingData esté completo (igual que en MP)
    const shippingData = extraData.shippingData || { 
        address: buyerInfo.address, 
        city: buyerInfo.city,
        department: buyerInfo.department || ""
    };

    // Datos del Cliente Normalizados
    const clientName = extraData.userName || buyerInfo.name || "Cliente";
    const clientPhone = extraData.phone || buyerInfo.phone || "";
    const clientDoc = extraData.clientDoc || buyerInfo.document || "";

// 3. Guardar Orden en Firebase (Estructura idéntica a MP)
    const newOrderRef = db.collection('orders').doc();
    const firebaseOrderId = newOrderRef.id;

    await newOrderRef.set({
        source: 'TIENDA_WEB', 
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        userId: uid, 
        userEmail: email,
        
        userName: clientName,
        phone: clientPhone,
        clientDoc: clientDoc,
        
        shippingData: shippingData,
        billingData: extraData.billingData || null,
        requiresInvoice: extraData.needsInvoice || false,

        items: dbItems, 
        subtotal: subtotal,
        shippingCost: shippingCost, 
        total: totalAmount, 
        
        status: 'PENDIENTE_PAGO',
        paymentMethod: paymentMethod, // 🔥 2. NUEVO: Asignamos la variable en lugar del texto fijo
        paymentStatus: 'PENDING', 
        isStockDeducted: false,
        buyerInfo: buyerInfo
    });

    // 4. Preparar Payload ADDI (Para la API Externa)
    const addiToken = await getAddiToken();

    // Limpieza específica para la API de ADDI (no afecta lo guardado en Firebase)
    const cleanDoc = String(clientDoc).replace(/\D/g, '');
    const fullNameParts = String(clientName).trim().split(" ");
    const firstName = fullNameParts[0];
    const lastName = fullNameParts.slice(1).join(" ") || "Apellido";

    let rawPhone = String(clientPhone).replace(/\D/g, '');
    let cellNumber = rawPhone.startsWith('57') ? rawPhone.substring(2) : rawPhone;
    if (!cellNumber) cellNumber = "3000000000"; // Fallback solo para API

    let cleanCity = removeAccents(shippingData.city || "Bogota").trim();
    if (cleanCity.toLowerCase().includes("bogota")) cleanCity = "Bogota D.C";

    const addressObj = {
        lineOne: removeAccents(String(shippingData.address || "Direccion")).substring(0, 60),
        city: cleanCity,
        country: "CO"
    };

    const addiPayload = {
        orderId: firebaseOrderId,
        totalAmount: totalAmount.toFixed(1),
        shippingAmount: shippingCost.toFixed(1),
        totalTaxesAmount: "0.0",
        currency: "COP",
        items: dbItems.map(i => ({
            sku: i.id.substring(0, 50),
            name: removeAccents(i.name).substring(0, 50),
            quantity: String(i.quantity),
            unitPrice: Math.round(i.price),
            tax: 0,
            pictureUrl: i.mainImage || i.image,
            category: "technology", // Categoría genérica segura
            brand: "PixelTech"
        })),
        client: {
            idType: "CC",
            idNumber: cleanDoc || "11111111", // Fallback solo para API
            firstName: removeAccents(firstName).substring(0, 50),
            lastName: removeAccents(lastName).substring(0, 50),
            email: String(email).trim().toLowerCase(),
            cellphone: cellNumber,
            cellphoneCountryCode: "+57",
            address: addressObj
        },
        shippingAddress: addressObj,
        billingAddress: addressObj,
        allyUrlRedirection: {
            logoUrl: "https://pixeltechcol.com/img/logo.webp",
            callbackUrl: WEBHOOK_URL,
            redirectionUrl: `https://pixeltechcol.com/shop/success.html?order=${firebaseOrderId}`
        }
    };

    console.log("📤 Enviando a ADDI:", JSON.stringify(addiPayload));

    try {
        const response = await axios.post(`${ADDI_BASE_URL}/v1/online-applications`, addiPayload, {
            headers: {
                'Authorization': `Bearer ${addiToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'PixelTechStore/1.0'
            },
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
        });

        let redirectUrl = null;
        if (response.status === 301 || response.status === 302) {
            redirectUrl = response.headers.location || response.headers.Location;
        } else if (response.data) {
            redirectUrl = response.data.redirectionUrl ||
                response.data.applicationUrl ||
                response.data._links?.webRedirect?.href ||
                (response.data.allyUrlRedirection && response.data.allyUrlRedirection.redirectionUrl);
        }

        if (!redirectUrl) throw new Error("ADDI no devolvió URL.");

        return { initPoint: redirectUrl };

    } catch (error) {
        console.error("❌ Error ADDI:", error.message);
        if (error.response) console.error("❌ Detalle:", JSON.stringify(error.response.data));
        throw new functions.https.HttpsError('internal', "Error iniciando pago con ADDI.");
    }
};



// ==========================================
// 2. WEBHOOK (BLINDADO CONTRA DUPLICADOS Y ORDENADO)
// ==========================================
exports.webhook = async (req, res) => {
    return cors(req, res, async () => {
        const db = admin.firestore();
        try {
            const body = req.body;
            console.log("🔔 Webhook ADDI:", JSON.stringify(body));

            const orderId = body.orderId;
            const status = body.status;

            if (!orderId) return res.status(400).send("Missing Order ID");

            const orderRef = db.collection('orders').doc(orderId);
            const remRef = db.collection('remissions').doc(orderId);

            if (status === 'APPROVED' || status === 'COMPLETED') {
                await db.runTransaction(async (t) => {
                    
                    // ==========================================
                    // FASE 1: SOLO LECTURAS (t.get)
                    // ==========================================
                    
                    // 1. Leer Orden
                    const docSnap = await t.get(orderRef);
                    if (!docSnap.exists) return;
                    const oData = docSnap.data();
                    
                    if (oData.paymentStatus === 'PAID' || oData.status === 'PAGADO') {
                        console.log(`⚠️ Webhook duplicado ignorado. La orden ${orderId} ya estaba pagada.`);
                        return;
                    }

                    // 2. Leer Inventario
                    const prodReads = [];
                    if (!oData.isStockDeducted) {
                        for (const i of oData.items) {
                            const pRef = db.collection('products').doc(i.id);
                            const pDoc = await t.get(pRef); // LECTURA
                            if (pDoc.exists) {
                                const pData = pDoc.data();
                                let newS = (pData.stock || 0) - (i.quantity || 1);
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

                    // 3. Leer Cuentas (Tesorería)
                    const accQ = await t.get(db.collection('accounts').where('gatewayLink', '==', 'ADDI').limit(1)); // LECTURA
                    let accDoc = (!accQ.empty) ? accQ.docs[0] : null;
                    if (!accDoc) {
                        const defQ = await t.get(db.collection('accounts').where('isDefaultOnline', '==', true).limit(1)); // LECTURA
                        if (!defQ.empty) accDoc = defQ.docs[0];
                    }

                    // 4. Leer Remisión (MovidO AQUÍ ARRIBA)
                    const remSnap = await t.get(remRef); // LECTURA FINAL

                    // ==========================================
                    // FASE 2: SOLO ESCRITURAS (t.set, t.update)
                    // ==========================================

                    // A. Escribir Tesorería
                    let accId = null, accName = 'ADDI';
                    if (accDoc) {
                        accId = accDoc.id;
                        accName = accDoc.data().name;
                        t.update(accDoc.ref, { balance: (Number(accDoc.data().balance) || 0) + (Number(oData.total) || 0) });

                        const incRef = db.collection('expenses').doc();
                        t.set(incRef, {
                            amount: Number(oData.total),
                            category: "Ingreso Ventas Online",
                            description: `Venta ADDI #${orderId.slice(0, 8)}`,
                            paymentMethod: accName,
                            date: admin.firestore.FieldValue.serverTimestamp(),
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            type: 'INCOME', orderId: orderId, supplierName: oData.userName
                        });
                    }

                    // B. Escribir Inventario
                    for (const p of prodReads) {
                        t.update(p.ref, { stock: p.stock, combinations: p.combos });
                    }

                    // C. Escribir Remisión
                    if (!remSnap.exists) {
                        t.set(remRef, {
                            orderId, source: 'WEBHOOK_ADDI', items: oData.items,
                            clientName: oData.userName, clientPhone: oData.phone, clientDoc: oData.clientDoc,
                            clientAddress: `${oData.shippingData?.address}, ${oData.shippingData?.city}`,
                            total: oData.total, status: 'PENDIENTE_ALISTAMIENTO', type: 'VENTA_WEB',
                            createdAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }

                    // D. Actualizar Orden a PAGADO
                    t.update(orderRef, {
                        status: 'PAGADO',
                        paymentStatus: 'PAID',
                        paymentId: body.applicationId || 'ADDI',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        isStockDeducted: true
                    });
                });
                
                console.log("✅ ADDI Approved Procesado Correctamente");
                
            } else if (status === 'REJECTED' || status === 'DECLINED' || status === 'ABANDONED') {
                const docCheck = await orderRef.get();
                if (docCheck.exists && docCheck.data().paymentStatus !== 'PAID') {
                    await orderRef.update({
                        status: 'RECHAZADO',
                        statusDetail: status
                    });
                    console.log("❌ Orden Rechazada por ADDI");
                }
            }
            res.status(200).send("OK");
        } catch (e) {
            console.error("Webhook Error:", e);
            res.status(500).send("Error");
        }
    });
};