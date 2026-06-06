// functions/falabella.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

/**
 * GENERADOR DE FIRMAS HMAC-SHA256 PARA FALABELLA SELLER CENTER
 */
function generateSignature(params, apiKey) {
    // 1. Ordenar los parámetros alfabéticamente por llave
    const sortedKeys = Object.keys(params).sort();
    
    // 2. URL-encodear llaves y valores en formato RFC 3986
    const queryParts = sortedKeys.map(key => {
        const val = String(params[key]);
        const encodedKey = encodeURIComponent(key).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        const encodedVal = encodeURIComponent(val).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        return `${encodedKey}=${encodedVal}`;
    });
    
    const queryString = queryParts.join("&");
    
    // 3. Generar Hash HMAC-SHA256 en formato hex minúscula
    return crypto.createHmac("sha256", apiKey)
        .update(queryString)
        .digest("hex");
}

/**
 * CLIENTE SEGURO DE LLAMADAS HTTP AL API DE FALABELLA
 */
async function callFalabellaAPI(action, extraParams, config) {
    const { userId, apiKey, apiUrl } = config;
    const baseUrl = apiUrl || "https://sellercenter-api.falabella.com/";
    
    const params = {
        Action: action,
        Format: "JSON",
        Timestamp: new Date().toISOString(),
        UserID: userId,
        Version: "1.0",
        ...extraParams
    };
    
    // Firmamos los parámetros
    params.Signature = generateSignature(params, apiKey);
    
    // Construimos la URL completa con los query parameters
    const queryParts = Object.keys(params).map(key => {
        return `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`;
    });
    const url = `${baseUrl.replace(/\/$/, "")}/?${queryParts.join("&")}`;
    
    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Accept": "application/json"
        }
    });
    
    if (!response.ok) {
        throw new Error(`Error en API Falabella (${action}): ${response.statusText}`);
    }
    
    const resData = await response.json();
    if (resData.ErrorResponse) {
        const errHead = resData.ErrorResponse.Head || {};
        throw new Error(`Error de Falabella Head: ${errHead.ErrorMessage || "Error desconocido"}`);
    }
    
    return resData;
}

/**
 * BUSCADOR INTELIGENTE DE EAN/SKU (Misma lógica ultra-segura de MercadoLibre)
 */
async function findProductByEAN(db, eanToFind) {
    if (!eanToFind) return null;
    const ean = String(eanToFind).trim().toUpperCase();
    if (ean === "" || ean === "UNDEFINED" || ean === "NULL") return null;
    
    const simpleQuery = await db.collection('products').where('sku', '==', ean).limit(1).get();
    if (!simpleQuery.empty) {
        return { docId: simpleQuery.docs[0].id, isVariant: false };
    }

    const variantsQuery = await db.collection('products').where('hasVariants', '==', true).get();
    for (const doc of variantsQuery.docs) {
        const pData = doc.data();
        if (pData.combinations) {
            const variantIndex = pData.combinations.findIndex(c => String(c.sku).trim().toUpperCase() === ean);
            if (variantIndex >= 0) {
                return { 
                    docId: doc.id, 
                    isVariant: true, 
                    variantIndex: variantIndex,
                    color: pData.combinations[variantIndex].color,
                    capacity: pData.combinations[variantIndex].capacity
                };
            }
        }
    }
    return null;
}

// ============================================================================
// 1. WEBHOOK DE COMPRAS DE FALABELLA MARKETPLACE
// ============================================================================
exports.webhook = async (req, res) => {
    const db = admin.firestore();

    try {
        // Extraer ID de orden desde el POST de Falabella
        const orderIdRaw = req.body.OrderId || req.query.OrderId || (req.body.data && req.body.data.OrderId) || (req.body.Order && req.body.Order.Id);
        
        // Responder OK rápido a Falabella para que no reintente
        res.status(200).send("OK");

        if (!orderIdRaw) {
            console.warn("⚠️ Webhook Falabella invocado sin OrderId válido.");
            return;
        }

        const orderId = `FAL-${orderIdRaw}`;
        console.log(`📦 Nueva orden de Falabella detectada: ${orderIdRaw}`);

        // --- LEER CONFIGURACIÓN DESDE FIRESTORE ---
        const falabellaConfigDoc = await db.collection('config').doc('falabella').get();
        if (!falabellaConfigDoc.exists) throw new Error("Falta el documento config/falabella en base de datos.");
        const config = falabellaConfigDoc.data();

        // Evitar reprocesar órdenes duplicadas y gestionar cancelaciones
        const orderCheck = await db.collection('orders').doc(orderId).get();
        if (orderCheck.exists) {
            const existingOrder = orderCheck.data();
            
            // Si ya está marcada como cancelada localmente, salimos rápido
            if (existingOrder.status === 'CANCELADO') return;

            try {
                // Consultamos el estado vigente en Falabella
                const orderRes = await callFalabellaAPI("GetOrder", { OrderId: orderIdRaw }, config);
                const orderDetails = orderRes.SuccessResponse.Body.Orders[0] || orderRes.SuccessResponse.Body.Order;
                if (orderDetails) {
                    const newStatus = String(orderDetails.Status || orderDetails.status || "").toLowerCase().trim();
                    if ((newStatus === 'canceled' || newStatus === 'cancelled' || newStatus === 'returned' || newStatus === 'shipped_back') && existingOrder.status !== 'CANCELADO') {
                        console.log(`⚠️ Orden de Falabella ${orderId} fue CANCELADA. Revirtiendo stock y estado.`);
                        await db.runTransaction(async (t) => {
                            // 1. Devolver Stock
                            for (const item of existingOrder.items || []) {
                                if (item.id && !item.id.includes('UNKNOWN')) {
                                    const pRef = db.collection('products').doc(item.id);
                                    const pDoc = await t.get(pRef);
                                    if (pDoc.exists) {
                                        const pData = pDoc.data();
                                        let newStock = (pData.stock || 0) + item.quantity;
                                        let updatePayload = { stock: newStock, updatedAt: admin.firestore.FieldValue.serverTimestamp() };

                                        if (item.color || item.capacity) {
                                            let newCombos = [...(pData.combinations || [])];
                                            const idx = newCombos.findIndex(c => 
                                                (c.color === item.color || (!c.color && !item.color)) &&
                                                (c.capacity === item.capacity || (!c.capacity && !item.capacity))
                                            );
                                            if (idx >= 0) {
                                                newCombos[idx].stock = (newCombos[idx].stock || 0) + item.quantity;
                                                updatePayload.combinations = newCombos;
                                            }
                                        }
                                        t.update(pRef, updatePayload);
                                    }
                                }
                            }

                            // 2. Descontar balance de la cuenta de tesorería (Reverso)
                            if (existingOrder.paymentAccountId) {
                                const accRef = db.collection('accounts').doc(existingOrder.paymentAccountId);
                                const accDoc = await t.get(accRef);
                                if (accDoc.exists) {
                                    t.update(accRef, { balance: Math.max(0, (Number(accDoc.data().balance) || 0) - Number(existingOrder.total)) });
                                    
                                    // Crear un reverso (EXPENSE) de anulación
                                    const expenseRef = db.collection('expenses').doc();
                                    t.set(expenseRef, {
                                        amount: Number(existingOrder.total),
                                        category: "Anulación de Venta",
                                        description: `Reverso por cancelación de Orden Falabella #${orderIdRaw}`,
                                        paymentMethod: accDoc.data().name, type: 'EXPENSE', orderId: orderId,
                                        isRefund: true, date: admin.firestore.FieldValue.serverTimestamp(),
                                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                                    });
                                }
                            }

                            // 3. Marcar Orden como CANCELADA
                            t.update(db.collection('orders').doc(orderId), {
                                status: 'CANCELADO',
                                paymentStatus: 'CANCELLED',
                                billingStatus: 'CANCELLED',
                                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                                notes: (existingOrder.notes || "") + " [Webhook Falabella: Orden cancelada por la plataforma]"
                            });
                        });
                        console.log(`✅ Stock y estado de la orden ${orderId} revertidos correctamente.`);
                    }
                }
            } catch (err) {
                console.error(`❌ Error al procesar cancelación de Falabella en el webhook:`, err);
            }
            return;
        }

        // --- CONSULTAR DETALLES DE LA ORDEN EN FALABELLA ---
        const orderRes = await callFalabellaAPI("GetOrder", { OrderId: orderIdRaw }, config);
        const orderDetails = orderRes.SuccessResponse.Body.Orders[0] || orderRes.SuccessResponse.Body.Order;
        if (!orderDetails) throw new Error(`No se encontró la orden ${orderIdRaw} en la API de Falabella.`);

        // --- CONSULTAR ITEMS DE LA ORDEN EN FALABELLA ---
        const itemsRes = await callFalabellaAPI("GetOrderItems", { OrderId: orderIdRaw }, config);
        let itemsList = itemsRes.SuccessResponse.Body.OrderItems;
        if (!Array.isArray(itemsList)) {
            itemsList = itemsList ? [itemsList] : [];
        }

        // --- PROCESAR DATOS DE ENVÍO ---
        const address = orderDetails.AddressShipping?.Address1 || "Acordar con comprador";
        const city = orderDetails.AddressShipping?.City || "Medellin";
        const carrier = itemsList[0]?.ShippingProvider || "Falabella Envios";
        const trackingNum = itemsList[0]?.TrackingCode || "Pendiente";

        const shippingData = {
            address: address,
            city: city,
            department: orderDetails.AddressShipping?.Region || "",
            guideNumber: trackingNum,
            carrier: carrier
        };

        // --- CREAR O ACTUALIZAR CLIENTE ---
        const buyerName = `${orderDetails.CustomerFirstName || ''} ${orderDetails.CustomerLastName || ''}`.trim() || "Cliente Falabella";
        const buyerDoc = String(orderDetails.AddressShipping?.Phone2 || orderDetails.AddressShipping?.Phone || orderIdRaw); // Usamos teléfono o ID como doc fallback
        const buyerPhone = orderDetails.AddressShipping?.Phone || "";
        const buyerEmail = orderDetails.CustomerEmail || "";

        let userId = `FAL-${buyerDoc}`;
        const userQ = await db.collection('users').where('document', '==', buyerDoc).limit(1).get();
        if (!userQ.empty) {
            userId = userQ.docs[0].id;
        } else {
            const newUserRef = await db.collection('users').add({
                name: buyerName, document: buyerDoc, phone: buyerPhone, email: buyerEmail,
                source: 'FALABELLA', role: 'client', address: shippingData.address, city: shippingData.city,
                dept: shippingData.department, createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            userId = newUserRef.id;
        }

        // --- ARMAR ITEMS Y DESCUENTOS ---
        let dbItems = [];
        let itemsToDeduct = [];
        let totalAmount = 0;

        for (const item of itemsList) {
            const ean = item.SellerSku; 
            const price = Number(item.ItemPrice) || 0;
            totalAmount += price;

            const foundProduct = await findProductByEAN(db, ean);
            if (foundProduct) {
                itemsToDeduct.push({ ...foundProduct, qty: 1 });
            }

            dbItems.push({
                id: foundProduct ? foundProduct.docId : `FAL-UNKNOWN-${ean}`,
                name: item.Name || item.Title || "Producto Falabella",
                price: price,
                quantity: 1,
                color: foundProduct ? foundProduct.color : "",
                capacity: foundProduct ? foundProduct.capacity : "",
                sku: ean
            });
        }

        // --- TRANSACCIÓN SEGURA EN FIRESTORE ---
        await db.runTransaction(async (t) => {
            // Registrar saldo en la cuenta de tesorería "Falabella"
            const accQ = await t.get(db.collection('accounts').where('name', '==', 'Falabella').limit(1));
            let accId = null, accName = 'Falabella';
            if (!accQ.empty) {
                const accDoc = accQ.docs[0];
                accId = accDoc.id;
                t.update(accDoc.ref, { balance: (Number(accDoc.data().balance) || 0) + Number(totalAmount) });
            }

            // Descontar inventarios
            for (const p of itemsToDeduct) {
                const pRef = db.collection('products').doc(p.docId);
                const pDoc = await t.get(pRef);
                if (pDoc.exists) {
                    const pData = pDoc.data();
                    let newStock = Math.max(0, (pData.stock || 0) - p.qty);
                    let updatePayload = { stock: newStock };

                    if (p.isVariant && pData.combinations) {
                        let newCombos = [...pData.combinations];
                        if (newCombos[p.variantIndex]) {
                            newCombos[p.variantIndex].stock = Math.max(0, newCombos[p.variantIndex].stock - p.qty);
                        }
                        updatePayload.combinations = newCombos;
                    }
                    t.update(pRef, updatePayload);
                }
            }

            // Registrar ingreso
            if (accId) {
                const incomeRef = db.collection('expenses').doc();
                t.set(incomeRef, {
                    amount: Number(totalAmount),
                    category: "Ingreso Ventas Online",
                    description: `Venta Falabella #${orderIdRaw}`,
                    paymentMethod: accName, type: 'INCOME', orderId: orderId,
                    supplierName: buyerName, date: admin.firestore.FieldValue.serverTimestamp(),
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            // Crear la orden de compra
            const orderRef = db.collection('orders').doc(orderId);
            t.set(orderRef, {
                source: 'FALABELLA', createdAt: admin.firestore.FieldValue.serverTimestamp(),
                userId: userId, userName: buyerName, phone: buyerPhone, clientDoc: buyerDoc,
                shippingData: shippingData, shippingCarrier: shippingData.carrier, shippingTracking: shippingData.guideNumber,
                shippingId: String(orderIdRaw), // Para Falabella el ID de rótulo es el mismo ID de orden
                items: dbItems, subtotal: totalAmount, shippingCost: 0, total: totalAmount,
                status: trackingNum !== 'Pendiente' ? 'DESPACHADO' : 'ALISTADO',
                paymentMethod: 'FALABELLA', paymentStatus: 'PAID', amountPaid: totalAmount,
                isStockDeducted: true, paymentAccountId: accId
            });
        });

        console.log(`✅ Orden Falabella ${orderId} creada con éxito.`);

    } catch (error) {
        console.error("❌ Error en Webhook de Falabella:", error);
    }
};

// ============================================================================
// 2. OBTENER RÓTULO DE DESPACHO EN PDF (STREAM EN VIVO)
// ============================================================================
exports.getLabel = async (req, res) => {
    const db = admin.firestore();
    
    // CORS básico
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).send('');
    }

    try {
        const orderIdRaw = req.query.orderId || req.query.order_id;
        if (!orderIdRaw) {
            return res.status(400).send("Error: Falta el orderId en los parámetros.");
        }

        // --- LEER CONFIGURACIÓN ---
        const falabellaConfigDoc = await db.collection('config').doc('falabella').get();
        if (!falabellaConfigDoc.exists) {
            return res.status(404).send("Error: No se encontró la configuración para Falabella en Firestore.");
        }
        const config = falabellaConfigDoc.data();

        console.log(`☁️ Descargando etiqueta Falabella para orden: ${orderIdRaw}`);

        // --- SOLICITAR DOCUMENTO EN SELLER CENTER ---
        const labelRes = await callFalabellaAPI("GetDocument", {
            DocumentType: "shippingLabel",
            OrderIdList: `[${orderIdRaw}]`
        }, config);

        const documentData = labelRes.SuccessResponse?.Body?.Documents?.Document || labelRes.SuccessResponse?.Body?.Document;
        if (!documentData || !documentData.FileContent) {
            console.error("❌ Respuesta sin archivo de Falabella:", JSON.stringify(labelRes));
            return res.status(404).send("Error: Falabella no devolvió contenido de archivo para esta orden.");
        }

        // --- DECODIFICAR EL BASE64 Y ENVIAR PDF ---
        const base64Content = documentData.FileContent;
        const buffer = Buffer.from(base64Content, 'base64');

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="rotulo_falabella_${orderIdRaw}.pdf"`);
        return res.status(200).send(buffer);

    } catch (error) {
        console.error("❌ Error en getLabel Falabella:", error);
        return res.status(500).send("Error interno del servidor al descargar rótulo de Falabella.");
    }
};
