// functions/mercadolibre3.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");

async function getMLConfig(db) {
    let appId = process.env.ML_APP_ID_3;
    let clientSecret = process.env.ML_CLIENT_SECRET_3;
    let redirectUri = process.env.ML_REDIRECT_URI_3;

    try {
        const devConfigDoc = await db.collection('config').doc('developer').get();
        if (devConfigDoc.exists) {
            const devData = devConfigDoc.data();
            if (devData.ML_APP_ID_3) appId = devData.ML_APP_ID_3;
            if (devData.ML_CLIENT_SECRET_3) clientSecret = devData.ML_CLIENT_SECRET_3;
            if (devData.ML_REDIRECT_URI_3) redirectUri = devData.ML_REDIRECT_URI_3;
        }
    } catch (err) {
        console.error("Error reading ML3 config from Firestore:", err);
    }
    return { appId, clientSecret, redirectUri };
}

async function getMLToken(db, storeDocName = 'mercadolibre_store3') {
    try {
        const docRef = db.collection('config').doc(storeDocName);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            const data = docSnap.data();
            if (data && data.accessToken) return data.accessToken;
        }
    } catch (e) {
        console.error(`Error obteniendo token para ${storeDocName}:`, e);
    }
    return null;
}

/**
 * RENOVACIÓN AUTOMÁTICA DE TOKEN DE MERCADOLIBRE VENCIDO (TIENDA 3)
 */
async function refreshMLAccessToken(db, storeDocName = 'mercadolibre_store3') {
    const mlConfig = await getMLConfig(db);
    const docRef = db.collection('config').doc(storeDocName);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) throw new Error(`Falta configuración de ${storeDocName} en DB`);
    const data = docSnap.data();
    let refreshToken = data.refreshToken || data.refresh_token;

    if (!refreshToken) {
        const devDoc = await db.collection('config').doc('developer').get();
        if (devDoc.exists) {
            const dData = devDoc.data();
            refreshToken = dData.refreshToken_store3 || dData.ML_REFRESH_TOKEN_3;
        }
    }

    if (!refreshToken) throw new Error(`No hay refreshToken guardado para ${storeDocName}`);

    console.log(`🔄 Renovando token de acceso vencido para ${storeDocName}...`);

    const res = await fetch("https://api.mercadolibre.com/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            client_id: mlConfig.appId,
            client_secret: mlConfig.clientSecret,
            refresh_token: refreshToken
        })
    });

    const tokenData = await res.json();
    if (res.ok && tokenData.access_token) {
        console.log(`✅ Token de ${storeDocName} renovado exitosamente.`);
        const tokenPayload = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token || refreshToken,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await docRef.set(tokenPayload, { merge: true });
        await db.collection('config').doc('developer').set({
            ML_ACCESS_TOKEN_3: tokenData.access_token,
            ML_REFRESH_TOKEN_3: tokenData.refresh_token || refreshToken
        }, { merge: true });
        await db.collection('config').doc('services_status').set({
            ml3: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return tokenData.access_token;
    } else {
        console.error(`❌ Error al renovar token de ${storeDocName}:`, tokenData);
        throw new Error(`Error renovando token ML (${storeDocName}): ${JSON.stringify(tokenData)}`);
    }
}

// Función auxiliar para hacer peticiones a la API de MercadoLibre con auto-renovación si vence el token (401)
async function fetchML(endpoint, token, db = null, storeDocName = 'mercadolibre_store3') {
    try {
        const url = endpoint.startsWith('http') ? endpoint : `https://api.mercadolibre.com${endpoint}`;
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if ((response.status === 401 || response.statusText === 'Unauthorized') && db) {
            console.log(`⚠️ Token 401 Unauthorized detectado en ${endpoint}. Renovando token automáticamente...`);
            const newToken = await refreshMLAccessToken(db, storeDocName);
            const retryRes = await fetch(url, {
                headers: { Authorization: `Bearer ${newToken}` }
            });
            if (!retryRes.ok) throw new Error(`Error en API ML3 (Reintento): ${retryRes.statusText}`);
            return await retryRes.json();
        }

        if (!response.ok) throw new Error(`Error en API ML3: ${response.statusText}`);
        return await response.json();
    } catch (err) {
        if (err.message && err.message.includes('Unauthorized') && db) {
            console.log(`⚠️ Capturado error Unauthorized en catch (ML3). Intentando renovar token...`);
            const newToken = await refreshMLAccessToken(db, storeDocName);
            const url = endpoint.startsWith('http') ? endpoint : `https://api.mercadolibre.com${endpoint}`;
            const retryRes = await fetch(url, {
                headers: { Authorization: `Bearer ${newToken}` }
            });
            if (!retryRes.ok) throw new Error(`Error en API ML3 (Reintento): ${retryRes.statusText}`);
            return await retryRes.json();
        }
        throw err;
    }
}

/**
 * BUSCADOR INTELIGENTE DE PRODUCTOS EN EL CATÁLOGO (TIENDA 3)
 */
const normalizeCode = (val) => val ? String(val).trim().toUpperCase().replace(/[\s\-_]/g, '') : '';
const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";

async function findProductInStore(db, item) {
    if (!item || !item.item) return null;

    const candidateCodes = [
        item.item.seller_sku,
        item.item.seller_custom_field,
        item.item.id,
        item.item.variation_id
    ].filter(Boolean).map(c => String(c).trim());

    if (Array.isArray(item.item.attributes)) {
        for (const attr of item.item.attributes) {
            const id = (attr.id || attr.name || '').toUpperCase();
            if (id.includes('EAN') || id.includes('GTIN') || id.includes('SKU') || id.includes('BARCODE') || id.includes('SELLER_SKU')) {
                if (attr.value_name) candidateCodes.push(String(attr.value_name).trim());
            }
        }
    }

    const normCandidateCodes = candidateCodes.map(c => normalizeCode(c)).filter(Boolean);
    const itemTitle = normalizeText(item.item.title || '');

    let varColor = '';
    let varCapacity = '';
    if (Array.isArray(item.item.variation_attributes)) {
        for (const va of item.item.variation_attributes) {
            const name = (va.name || '').toLowerCase();
            if (name.includes('color')) varColor = normalizeText(va.value_name || '');
            if (name.includes('capacidad') || name.includes('tamaño') || name.includes('almacenamiento') || name.includes('memoria')) {
                varCapacity = normalizeText(va.value_name || '');
            }
        }
    }

    // 1. Consulta rápida por códigos directos en Firestore
    for (const rawCode of candidateCodes) {
        const upperCode = rawCode.toUpperCase();
        for (const field of ['sku', 'ean', 'barcode', 'ref', 'code', 'mlItemId']) {
            const q = await db.collection('products').where(field, '==', upperCode).limit(1).get();
            if (!q.empty) {
                const pData = q.docs[0].data();
                const img = pData.mainImage || pData.image || (Array.isArray(pData.images) && pData.images[0]) || "";
                return { 
                    docId: q.docs[0].id, 
                    isVariant: false, 
                    name: pData.name || pData.title || item.item.title,
                    sku: pData.sku || rawCode,
                    image: img, 
                    productData: pData 
                };
            }
        }
    }

    // 2. Traer todos los productos para escaneo profundo
    const allProdsSnap = await db.collection('products').get();
    let nameMatchFallback = null;

    for (const doc of allProdsSnap.docs) {
        const pData = doc.data();
        const pId = doc.id;
        const pImg = pData.mainImage || pData.image || (Array.isArray(pData.images) && pData.images[0]) || "";
        const pName = pData.name || pData.title || '';
        const pNameNorm = normalizeText(pName);

        // A. Combinaciones
        if (Array.isArray(pData.combinations) && pData.combinations.length > 0) {
            for (let idx = 0; idx < pData.combinations.length; idx++) {
                const comb = pData.combinations[idx];
                const combCodes = [comb.sku, comb.ean, comb.barcode, comb.ref, comb.code, comb.mlVariationId].filter(Boolean).map(normalizeCode);
                
                if (normCandidateCodes.some(nc => combCodes.includes(nc))) {
                    const cImg = comb.image || pImg;
                    return {
                        docId: pId,
                        isVariant: true,
                        variantIndex: idx,
                        name: pName,
                        sku: comb.sku || pData.sku || '',
                        color: comb.color || "",
                        capacity: comb.capacity || "",
                        image: cImg,
                        productData: pData
                    };
                }

                if (itemTitle && pNameNorm && (itemTitle.includes(pNameNorm) || pNameNorm.includes(itemTitle))) {
                    const cColorNorm = normalizeText(comb.color || '');
                    const cCapNorm = normalizeText(comb.capacity || '');
                    const colorMatches = varColor ? (cColorNorm === varColor) : (!cColorNorm || itemTitle.includes(cColorNorm));
                    const capMatches = varCapacity ? (cCapNorm === varCapacity) : (!cCapNorm || itemTitle.includes(cCapNorm));
                    if (colorMatches && capMatches) {
                        const cImg = comb.image || pImg;
                        return {
                            docId: pId,
                            isVariant: true,
                            variantIndex: idx,
                            name: pName,
                            sku: comb.sku || pData.sku || '',
                            color: comb.color || "",
                            capacity: comb.capacity || "",
                            image: cImg,
                            productData: pData
                        };
                    }
                }
            }
        }

        // B. Código de producto raíz
        const rootCodes = [pData.sku, pData.ean, pData.barcode, pData.ref, pData.code, pData.mlItemId].filter(Boolean).map(normalizeCode);
        if (normCandidateCodes.some(nc => rootCodes.includes(nc))) {
            return { 
                docId: pId, 
                isVariant: false, 
                name: pName, 
                sku: pData.sku || '', 
                image: pImg, 
                productData: pData 
            };
        }

        // C. Fallback por coincidencia de nombre
        if (itemTitle && pNameNorm) {
            if (itemTitle === pNameNorm) {
                return { 
                    docId: pId, 
                    isVariant: false, 
                    name: pName, 
                    sku: pData.sku || '', 
                    image: pImg, 
                    productData: pData 
                };
            }
            const itemHasPack = itemTitle.includes('pack') || itemTitle.includes('kit') || itemTitle.includes('unidades');
            const prodHasPack = pNameNorm.includes('pack') || pNameNorm.includes('kit') || pNameNorm.includes('unidades');
            if (itemHasPack === prodHasPack && (itemTitle.includes(pNameNorm) || pNameNorm.includes(itemTitle))) {
                if (!nameMatchFallback) {
                    nameMatchFallback = { 
                        docId: pId, 
                        isVariant: false, 
                        name: pName, 
                        sku: pData.sku || '', 
                        image: pImg, 
                        productData: pData 
                    };
                }
            }
        }
    }

    if (nameMatchFallback) {
        return nameMatchFallback;
    }

    return null;
}

async function findProductByEAN(db, eanToFind) {
    return findProductInStore(db, { item: { seller_sku: eanToFind } });
}

/**
 * OBTENER COSTO DE ENVÍO VENDEDOR DESDE API SHIPMENTS DE MERCADOLIBRE (TIENDA 3)
 */
async function getMLShipmentCost(shippingId, token, db = null, storeDocName = 'mercadolibre_store3') {
    if (!shippingId || !token) return 0;
    try {
        const sData = await fetchML(`/shipments/${shippingId}`, token, db, storeDocName);
        if (sData) {
            if (sData.logistic_type === 'self_service') {
                console.log(`🛵 Envío Flex detectado (${shippingId}): Costo Vendedor ML3 = $0`);
                return 0;
            }

            let cost = 0;
            if (sData.shipping_option) {
                if (typeof sData.shipping_option.list_cost === 'number' && sData.shipping_option.list_cost > 0) {
                    cost = sData.shipping_option.list_cost;
                } else if (typeof sData.shipping_option.base_cost === 'number' && sData.shipping_option.base_cost > 0) {
                    cost = sData.shipping_option.base_cost;
                } else if (typeof sData.shipping_option.cost === 'number' && sData.shipping_option.cost > 0) {
                    cost = sData.shipping_option.cost;
                }
            }
            if (!cost && typeof sData.list_cost === 'number' && sData.list_cost > 0) cost = sData.list_cost;
            if (!cost && typeof sData.base_cost === 'number' && sData.base_cost > 0) cost = sData.base_cost;
            if (!cost && sData.snapshot && typeof sData.snapshot.cost === 'number' && sData.snapshot.cost > 0) cost = sData.snapshot.cost;
            if (!cost && typeof sData.cost === 'number' && sData.cost > 0) cost = sData.cost;

            console.log(`📦 Costo de Envío Vendedor ML3 (${shippingId}): $${cost}`);
            return Number(cost) || 0;
        }
    } catch (err) {
        console.error("Error obteniendo shipment cost de ML3:", err);
    }
    return 0;
}

function extractMLShippingBonus(orderData, rawShipment = null) {
    let mlShippingBonus = 0;

    if (Array.isArray(orderData.payments)) {
        for (const p of orderData.payments) {
            if (p.status === 'approved') {
                if (typeof p.shipping_cost === 'number' && p.shipping_cost < 0) {
                    mlShippingBonus += Math.abs(Math.round(p.shipping_cost));
                }
                if (Array.isArray(p.fee_details)) {
                    for (const fd of p.fee_details) {
                        const feeType = (fd.fee_type || fd.type || '').toLowerCase();
                        if (feeType.includes('bonus') || feeType.includes('bonific') || feeType.includes('subsidy') || feeType.includes('rebate')) {
                            mlShippingBonus += Math.abs(Math.round(Number(fd.amount) || 0));
                        }
                    }
                }
            }
        }
    }

    if (orderData.shipping && typeof orderData.shipping.shipping_bonus === 'number' && orderData.shipping.shipping_bonus > 0) {
        if (orderData.shipping.shipping_bonus > mlShippingBonus) {
            mlShippingBonus = Math.round(orderData.shipping.shipping_bonus);
        }
    }

    if (rawShipment && rawShipment.logistic_type === 'self_service') {
        let flexBonus = 0;
        if (typeof rawShipment.shipping_bonus === 'number' && rawShipment.shipping_bonus > 0) {
            flexBonus = rawShipment.shipping_bonus;
        } else if (typeof rawShipment.base_cost === 'number' && rawShipment.shipping_option?.list_cost) {
            flexBonus = Math.max(0, rawShipment.base_cost - rawShipment.shipping_option.list_cost);
        } else if (typeof rawShipment.base_cost === 'number' && rawShipment.base_cost > 0) {
            flexBonus = rawShipment.base_cost;
        }
        if (flexBonus > mlShippingBonus) {
            mlShippingBonus = Math.round(flexBonus);
        }
    }

    return Math.round(mlShippingBonus);
}

/**
 * EXTRAER INFORMACIÓN COMPLETA Y CONFIABLE DEL COMPRADOR Y ENVÍO (TIENDA 3)
 */
function extractMLBuyerInfo(orderData, shipment, billingInfo = null) {
    const buyer = orderData.buyer || {};

    const destination = shipment?.destination || {};
    const destAddress = destination?.shipping_address || shipment?.receiver_address || {};
    const billing = billingInfo?.billing_info || orderData.billing_info || orderData.billing || {};

    let name = "";
    if (billing.name && billing.name.trim().length > 0) {
        name = billing.name.trim();
    } else if (billing.legal_name && billing.legal_name.trim().length > 0) {
        name = billing.legal_name.trim();
    } else if (destination.receiver_name && destination.receiver_name.trim().length > 0) {
        name = destination.receiver_name.trim();
    } else if (shipment?.receiver_address?.receiver_name) {
        name = shipment.receiver_address.receiver_name.trim();
    } else if (buyer.first_name || buyer.last_name) {
        name = `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim();
    }
    if (!name && buyer.nickname) name = buyer.nickname.trim();
    if (!name) name = `Cliente MercadoLibre 3 (${buyer.id || 'S/N'})`;

    let phone = "";
    if (destination.receiver_phone && String(destination.receiver_phone).trim().length > 0) {
        phone = String(destination.receiver_phone).trim();
    } else if (destAddress.phone && String(destAddress.phone).trim().length > 0) {
        phone = String(destAddress.phone).trim();
    } else if (buyer.phone?.number) {
        phone = `${buyer.phone.area_code || ''} ${buyer.phone.number}`.trim();
    }

    let doc = "";
    const buyerIdent = billing.doc_number || 
                       billing.identification?.number || 
                       buyer.identification?.number || 
                       orderData.buyer?.identification?.number || 
                       buyer.billing_info?.doc_number || 
                       orderData.billing?.doc_number;
    
    if (buyerIdent && String(buyerIdent).trim().length > 0) {
        doc = String(buyerIdent).trim();
    } else if (destination.receiver_id && String(destination.receiver_id).trim().length > 0 && String(destination.receiver_id) !== String(buyer.id)) {
        doc = String(destination.receiver_id).trim();
    } else if (buyer.id) {
        doc = String(buyer.id);
    }

    let cleanPhoneDigits = phone.replace(/\D/g, '');
    let cleanDocDigits = doc.replace(/\D/g, '');
    if (cleanDocDigits && cleanPhoneDigits && cleanDocDigits === cleanPhoneDigits) {
        doc = buyerIdent ? String(buyerIdent).trim() : String(buyer.id || '');
    }

    let email = buyer.email || "";

    let address = "Acordar con el vendedor";
    if (destAddress.address_line && destAddress.address_line.trim().length > 0) {
        address = destAddress.address_line.trim();
        if (destAddress.comment) address += `, ${destAddress.comment.trim()}`;
        if (destAddress.neighborhood?.name) address += `, ${destAddress.neighborhood.name.trim()}`;
    } else if (destAddress.street_name) {
        let parts = [destAddress.street_name, destAddress.street_number, destAddress.comment, destAddress.neighborhood?.name].filter(Boolean);
        address = parts.join(', ');
    }

    let city = destAddress.city?.name || "";
    let department = destAddress.state?.name || "";

    return {
        name,
        doc,
        phone,
        email,
        address,
        city,
        department,
        guideNumber: shipment?.tracking_number || "Pendiente",
        carrier: shipment?.tracking_method || "MercadoEnvíos"
    };
}

// ============================================================================
// 1. WEBHOOK DE COMPRAS DE MERCADOLIBRE (TIENDA 3)
// ============================================================================
exports.webhook = async (req, res) => {
    const db = admin.firestore();

    try {
        // --- AUTO-VINCULACIÓN OAUTH POR CÓDIGO DE AUTORIZACIÓN (?code=...) ---
        const authCode = req.query.code;
        if (authCode) {
            console.log("🔑 Código de autorización MercadoLibre Tienda 3 recibido:", authCode);
            const mlConfig = await getMLConfig(db);
            const rawHost = req.get('host') || '';
            const protocol = rawHost.includes('localhost') ? 'http' : 'https';

            let cleanPath = (req.path || '').replace(/\/+$/, '');
            let redirectUri = req.query.redirect_uri || mlConfig.redirectUri || `${protocol}://${rawHost}${cleanPath}`;

            console.log(`🔗 Usando redirect_uri para canje de token ML3: ${redirectUri}`);

            const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    client_id: mlConfig.appId,
                    client_secret: mlConfig.clientSecret,
                    code: authCode,
                    redirect_uri: redirectUri
                })
            });

            const tokenData = await tokenRes.json();
            if (tokenRes.ok && tokenData.access_token) {
                const tokenPayload = {
                    accessToken: tokenData.access_token,
                    refreshToken: tokenData.refresh_token,
                    userId: tokenData.user_id,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                await db.collection('config').doc('mercadolibre_store3').set(tokenPayload, { merge: true });
                await db.collection('config').doc('developer').set({
                    ML_ACCESS_TOKEN_3: tokenData.access_token,
                    ML_REFRESH_TOKEN_3: tokenData.refresh_token,
                    ML_USER_ID_3: tokenData.user_id
                }, { merge: true });
                await db.collection('config').doc('services_status').set({
                    ml3: true,
                    ml3_userId: tokenData.user_id,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                return res.status(200).send(`
                    <div style="font-family:sans-serif; text-align:center; padding:60px 20px; background:#f9fafb; min-height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                        <div style="background:white; padding:40px; border-radius:24px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); max-width:480px; border:1px solid #e5e7eb;">
                            <div style="font-size:48px; margin-bottom:16px;">🎉</div>
                            <h1 style="color:#10B981; margin:0 0 12px 0; font-size:24px; font-weight:800;">¡MercadoLibre Tienda 3 Vinculado Exitosamente!</h1>
                            <p style="color:#4b5563; font-size:14px; line-height:1.6; margin-bottom:24px;">La aplicación ha guardado los tokens de acceso para la Tienda 3 y la sincronización está activa.</p>
                            <span style="background:#ecfdf5; color:#047857; padding:8px 16px; border-radius:12px; font-weight:700; font-size:12px; display:inline-block;">ID Usuario ML3: ${tokenData.user_id}</span>
                        </div>
                    </div>
                `);
            } else {
                console.error("❌ Error al canjear código ML3:", tokenData);
                return res.status(400).send(`Error al canjear código de MercadoLibre Tienda 3: ${JSON.stringify(tokenData)}`);
            }
        }

        const topic = req.body.topic || req.query.topic;
        const resource = req.body.resource; 
        
        if (topic !== 'orders_v2' && topic !== 'orders') return res.status(200).send("OK: Ignored topic");
        if (!resource) return res.status(200).send("OK: Missing resource");

        console.log(`📦 Nueva orden de MercadoLibre (TIENDA 3) detectada: ${resource}`);

        // --- LEER EL TOKEN VIGENTE DESDE FIRESTORE ---
        const mlConfigDoc = await db.collection('config').doc('mercadolibre_store3').get();
        if (!mlConfigDoc.exists) throw new Error("Falta configuración de ML3 en DB");
        const ML_TOKEN = mlConfigDoc.data().accessToken;

        const orderData = await fetchML(resource, ML_TOKEN, db, 'mercadolibre_store3');
        const orderId = `ML3-${orderData.id}`;

        console.log(`📥 RAW ML ORDER JSON (${orderId}):`, JSON.stringify(orderData));

        // --- DEPURACIÓN: GUARDAR EL JSON CRUDO COMPLETO PARA INSPECCIÓN ---
        try {
            let debugShipment = null;
            if (orderData.shipping && orderData.shipping.id) {
                try {
                    debugShipment = await fetchML(`/shipments/${orderData.shipping.id}`, ML_TOKEN, db, 'mercadolibre_store3');
                    console.log(`🚚 RAW ML SHIPMENT JSON (${orderId}):`, JSON.stringify(debugShipment));
                } catch (e) {
                    console.error("Error obteniendo debug shipment ML3:", e);
                }
            }
            await db.collection('ml_debug_logs').doc(orderId).set({
                orderId: orderId,
                orderData: orderData,
                rawShipment: debugShipment,
                receivedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (dbgErr) {
            console.error("Error al guardar log de depuración en ml_debug_logs (ML3):", dbgErr);
        }

        const orderCheck = await db.collection('orders').doc(orderId).get();
        if (orderCheck.exists) {
            const existingOrder = orderCheck.data();
            const newMLStatus = orderData.status;
            if (newMLStatus === 'cancelled' && existingOrder.status !== 'CANCELADO') {
                console.log(`⚠️ Orden de MercadoLibre 3 ${orderId} fue CANCELADA. Revirtiendo stock y estado.`);
                await db.runTransaction(async (t) => {
                    // --- 1. LECTURAS (READS) ---
                    const pDocsMap = new Map();
                    for (const item of existingOrder.items || []) {
                        if (item.id && !item.id.includes('UNKNOWN') && !pDocsMap.has(item.id)) {
                            const pRef = db.collection('products').doc(item.id);
                            const pDoc = await t.get(pRef);
                            if (pDoc.exists) pDocsMap.set(item.id, pDoc);
                        }
                    }

                    let accDoc = null;
                    if (existingOrder.paymentAccountId) {
                        const accRef = db.collection('accounts').doc(existingOrder.paymentAccountId);
                        const aDoc = await t.get(accRef);
                        if (aDoc.exists) accDoc = aDoc;
                    }

                    if (!accDoc) {
                        const accQ = await t.get(db.collection('accounts').where('name', 'in', ["MercadoLibre 3","MercadoLibre3","Mercado Libre 3","MercadoLibre"]).limit(1));
                        if (!accQ.empty) accDoc = accQ.docs[0];
                    }

                    // --- 2. ESCRITURAS (WRITES) ---
                    for (const item of existingOrder.items || []) {
                        if (item.id && pDocsMap.has(item.id)) {
                            const pDoc = pDocsMap.get(item.id);
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
                            t.update(pDoc.ref, updatePayload);
                        }
                    }

                    if (accDoc) {
                        const currentBalance = Number(accDoc.data().balance) || 0;
                        const refundAmount = Number(existingOrder.netAmount) || Number(existingOrder.total) || 0;
                        t.update(accDoc.ref, { balance: Math.max(0, currentBalance - refundAmount) });
                        
                        const expenseRef = db.collection('expenses').doc();
                        t.set(expenseRef, {
                            amount: refundAmount,
                            category: "Cancelaciones / Anulaciones",
                            description: `Reverso por cancelación de Orden ML3 #${orderData.id}`,
                            paymentMethod: accDoc.data().name || 'MercadoLibre 3',
                            supplierName: existingOrder.userName || "Cliente MercadoLibre 3",
                            date: admin.firestore.FieldValue.serverTimestamp(),
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            type: 'EXPENSE',
                            orderId: orderId
                        });
                    }

                    t.update(db.collection('orders').doc(orderId), {
                        status: 'CANCELADO',
                        paymentStatus: 'CANCELLED',
                        billingStatus: 'CANCELLED',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        notes: (existingOrder.notes || "") + " [Webhook ML3: Orden cancelada por el comprador/plataforma]"
                    });
                });
                console.log(`✅ Stock y estado de la orden ${orderId} revertidos correctamente.`);
                return res.status(200).send(`OK: Orden ${orderId} cancelada y revertida correctamente.`);
            }

            // --- ACTUALIZACIÓN AUTOMÁTICA EN LLEGADAS POSTERIORES DEL WEBHOOK ---
            let rawShipment = null;
            if (orderData.shipping && orderData.shipping.id) {
                try {
                    rawShipment = await fetchML(`/shipments/${orderData.shipping.id}`, ML_TOKEN, db, 'mercadolibre_store3');
                } catch (err) {}
            }

            let billingInfo = null;
            try {
                billingInfo = await fetchML(`/orders/${orderData.id}/billing_info`, ML_TOKEN, db, 'mercadolibre_store3');
            } catch (bErr) {}

            const buyerInfo = extractMLBuyerInfo(orderData, rawShipment, billingInfo);

            let grossTotal = Math.round(Number(orderData.total_amount) || 0);
            if (grossTotal === 0 && Array.isArray(orderData.order_items)) {
                for (const item of orderData.order_items) {
                    grossTotal += Math.round((Number(item.unit_price) || 0) * (Number(item.quantity) || 1));
                }
            }

            let sellerShippingCost = 0;
            if (orderData.shipping && orderData.shipping.id) {
                sellerShippingCost = await getMLShipmentCost(orderData.shipping.id, ML_TOKEN, db, 'mercadolibre_store3');
            } else if (orderData.shipping && Number(orderData.shipping.cost) > 0) {
                sellerShippingCost = Math.round(Number(orderData.shipping.cost));
            }

            let mlShippingBonus = extractMLShippingBonus(orderData, rawShipment);

            let mlTaxes = Math.round(getMLTaxesAmount(orderData));
            let mlFee = Math.round(getMLFeeAmount(orderData));

            if (Array.isArray(orderData.payments)) {
                for (const p of orderData.payments) {
                    if (p.status === 'approved' && p.id) {
                        try {
                            let deepPayment = null;
                            try {
                                deepPayment = await fetchML(`/collections/${p.id}`, ML_TOKEN, db, 'mercadolibre_store3');
                            } catch (cErr) {
                                try {
                                    deepPayment = await fetchML(`/v1/payments/${p.id}`, ML_TOKEN, db, 'mercadolibre_store3');
                                } catch (vErr) {}
                            }
                            if (deepPayment) {
                                const deepTax = Math.round(getMLTaxesAmount(deepPayment));
                                if (deepTax > mlTaxes) mlTaxes = deepTax;
                                const deepFee = Math.round(getMLFeeAmount(deepPayment));
                                if (deepFee > mlFee) mlFee = deepFee;
                            }
                        } catch (pErr) {}
                    }
                }
            }

            let netAmount = Math.max(0, Math.round(grossTotal - mlFee - sellerShippingCost - mlTaxes + mlShippingBonus));
            let totalDeductions = Math.max(0, grossTotal - netAmount);

            const oldGross = Number(existingOrder.grossTotal) || Number(existingOrder.total) || 0;
            const oldFee = Number(existingOrder.mlFee) || 0;
            const oldShipping = Number(existingOrder.mlShipping) || 0;
            const oldTaxes = Number(existingOrder.mlTaxes) || 0;
            const oldBonus = Number(existingOrder.mlShippingBonus) || 0;
            const oldNet = Number(existingOrder.netAmount) || Number(existingOrder.total) || 0;

            const hasFinancialDiff = (
                oldGross !== grossTotal ||
                oldFee !== mlFee ||
                oldShipping !== sellerShippingCost ||
                oldTaxes !== mlTaxes ||
                oldBonus !== mlShippingBonus ||
                oldNet !== netAmount
            );

            const hasDocDiff = (buyerInfo.doc && existingOrder.clientDoc !== buyerInfo.doc);
            const hasTrackingDiff = (rawShipment?.tracking_number && existingOrder.trackingNumber !== rawShipment.tracking_number);
            const hasShippingStatusDiff = (rawShipment?.status && existingOrder.shippingStatus !== rawShipment.status);

            if (hasFinancialDiff || hasDocDiff || hasTrackingDiff || hasShippingStatusDiff) {
                const netDiff = netAmount - oldNet;
                const priceRatio = grossTotal > 0 ? (netAmount / grossTotal) : 1;

                let updates = {
                    grossTotal: Math.round(grossTotal),
                    mlFee: Math.round(mlFee),
                    mlShipping: Math.round(sellerShippingCost),
                    mlTaxes: Math.round(mlTaxes),
                    mlShippingBonus: Math.round(mlShippingBonus),
                    netAmount: netAmount,
                    total: netAmount,
                    subtotal: netAmount,
                    amountPaid: netAmount,
                    totalDeductions: totalDeductions,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                };

                if (Array.isArray(existingOrder.items)) {
                    updates.items = existingOrder.items.map(it => {
                        let originalPrice = Number(it.grossPrice);
                        if (!originalPrice || originalPrice <= 0 || (existingOrder.items.length === 1 && originalPrice !== grossTotal)) {
                            originalPrice = (existingOrder.items.length === 1 && grossTotal > 0) ? grossTotal : (Number(it.price) || 0);
                        }
                        const itemNet = (existingOrder.items.length === 1 && netAmount > 0) ? Math.round(netAmount / (Number(it.quantity) || 1)) : Math.round(originalPrice * priceRatio);
                        return {
                            ...it,
                            grossPrice: originalPrice,
                            price: itemNet
                        };
                    });
                }

                if (buyerInfo) {
                    if (buyerInfo.doc) updates.clientDoc = buyerInfo.doc;
                    if (buyerInfo.name) updates.clientName = buyerInfo.name;
                    updates.buyerInfo = buyerInfo;
                }

                if (rawShipment) {
                    if (rawShipment.tracking_number) updates.trackingNumber = rawShipment.tracking_number;
                    if (rawShipment.status) updates.shippingStatus = rawShipment.status;
                }

                await db.collection('orders').doc(orderId).update(updates);

                const incRef = db.collection('expenses').doc(`INC-${orderId}`);
                const incSnap = await incRef.get();
                if (incSnap.exists) {
                    await incRef.update({
                        amount: netAmount,
                        grossAmount: Math.round(grossTotal),
                        deductions: totalDeductions,
                        description: `VENTA MERCADOLIBRE 3 #${orderId}` + (totalDeductions > 0 ? ` (NETO: $${netAmount.toLocaleString('es-CO')})` : ""),
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }

                if (netDiff !== 0) {
                    const accSnap = await db.collection('accounts').where('name', 'in', ["MercadoLibre 3","MercadoLibre3","Mercado Libre 3","MercadoLibre"]).limit(1).get();
                    if (!accSnap.empty) {
                        const accDoc = accSnap.docs[0];
                        const curBal = Number(accDoc.data().balance) || 0;
                        await accDoc.ref.update({ balance: curBal + netDiff });
                    }
                }

                console.log(`🔄 Orden ${orderId} actualizada automáticamente en webhook con nuevos datos de ML3 (Neto: $${oldNet} -> $${netAmount}, Comisión: $${mlFee}).`);
                return res.status(200).send(`OK: Orden ${orderId} actualizada con nueva información.`);
            }

            console.log(`ℹ️ La orden ${orderId} ya existe en la base de datos y está al día.`);
            return res.status(200).send(`OK: La orden ${orderId} ya existe en el sistema y está al día.`);
        }

        // Verificar si la orden ya fue consolidada en un paquete existente
        const packMembershipCheck = await db.collection('orders').where('packOrderIds', 'array-contains', String(orderData.id)).limit(1).get();
        if (!packMembershipCheck.empty) {
            console.log(`ℹ️ La orden ML3 #${orderData.id} ya fue consolidada en el paquete ${packMembershipCheck.docs[0].id}.`);
            return res.status(200).send(`OK: La orden ML3 #${orderData.id} ya fue consolidada previamente.`);
        }

        // --- DATOS DE ENVÍO Y GUÍA DETALLADOS ---
        let rawShipment = null;
        if (orderData.shipping && orderData.shipping.id) {
            try {
                rawShipment = await fetchML(`/shipments/${orderData.shipping.id}`, ML_TOKEN, db, 'mercadolibre_store3');
            } catch (err) {
                console.log("No se pudo obtener el envío de ML3 detallado.");
            }
        }

        // --- CONSULTAR INFORMACIÓN DE FACTURACIÓN ---
        let billingInfo = null;
        try {
            billingInfo = await fetchML(`/orders/${orderData.id}/billing_info`, ML_TOKEN, db, 'mercadolibre_store3');
            console.log(`🧾 RAW ML3 BILLING INFO (${orderId}):`, JSON.stringify(billingInfo));
        } catch (bErr) {
            console.log(`Info: No se pudo consultar billing_info de la orden ML3 ${orderData.id}:`, bErr.message);
        }

        // --- EXTRAER INFORMACIÓN COMPLETA DEL CLIENTE ---
        const buyerInfo = extractMLBuyerInfo(orderData, rawShipment, billingInfo);

        // --- CREAR O ACTUALIZAR CLIENTE EN FIRESTORE CON ID DETERMINÍSTICO ---
        const userDocId = buyerInfo.doc ? `DOC-${buyerInfo.doc}` : `ML3-${orderData.buyer?.id || 'CLIENTE'}`;
        const userRef = db.collection('users').doc(userDocId);
        let userId = userDocId;

        const existingUserSnap = await userRef.get();
        if (existingUserSnap.exists) {
            const existingUser = existingUserSnap.data();
            let userUpdates = {};
            if (!existingUser.document && buyerInfo.doc) userUpdates.document = buyerInfo.doc;
            if (!existingUser.phone && buyerInfo.phone) userUpdates.phone = buyerInfo.phone;
            if (!existingUser.address && buyerInfo.address) userUpdates.address = buyerInfo.address;
            if (!existingUser.city && buyerInfo.city) userUpdates.city = buyerInfo.city;
            if (!existingUser.dept && buyerInfo.department) userUpdates.dept = buyerInfo.department;
            if (!existingUser.email && buyerInfo.email) userUpdates.email = buyerInfo.email;
            if (Object.keys(userUpdates).length > 0) {
                await userRef.update(userUpdates);
            }
        } else {
            await userRef.set({
                name: buyerInfo.name,
                document: buyerInfo.doc || "",
                phone: buyerInfo.phone || "",
                email: buyerInfo.email || "",
                source: 'MERCADOLIBRE_3',
                role: 'client',
                address: buyerInfo.address || "",
                city: buyerInfo.city || "",
                dept: buyerInfo.department || "",
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

/**
 * EXTRAER IMPUESTOS Y RETENCIONES REALES DE LA ORDEN DE MERCADOLIBRE (TIENDA 3)
 */
function getMLTaxesAmount(orderData) {
    let totalTaxes = 0;

    if (orderData.taxes) {
        if (typeof orderData.taxes.amount === 'number' && orderData.taxes.amount > 0) {
            totalTaxes += orderData.taxes.amount;
        } else if (Array.isArray(orderData.taxes)) {
            for (const t of orderData.taxes) {
                totalTaxes += Number(t.amount || t.value || t.tax_amount) || 0;
            }
        }
    }

    if (!totalTaxes && typeof orderData.taxes_amount === 'number' && orderData.taxes_amount > 0) {
        totalTaxes = orderData.taxes_amount;
    }
    if (!totalTaxes && typeof orderData.withholding_taxes === 'number' && orderData.withholding_taxes > 0) {
        totalTaxes = orderData.withholding_taxes;
    }

    if (Array.isArray(orderData.payments)) {
        let paymentTaxes = 0;
        for (const p of orderData.payments) {
            if (p.status === 'approved') {
                const pType = (p.payment_type || '').toLowerCase();
                const paidAmt = Number(p.total_paid_amount) || Number(p.transaction_amount) || Number(orderData.total_amount) || 0;

                let reportedTax = 0;
                if (typeof p.taxes_amount === 'number' && p.taxes_amount > 0) {
                    reportedTax = p.taxes_amount;
                } else if (Array.isArray(p.taxes)) {
                    for (const pt of p.taxes) {
                        reportedTax += Number(pt.amount || pt.value || pt.tax_amount) || 0;
                    }
                }
                if (Array.isArray(p.fee_details)) {
                    for (const fd of p.fee_details) {
                        const feeType = (fd.fee_type || fd.type || '').toLowerCase();
                        if (feeType.includes('tax') || feeType.includes('retencion') || feeType.includes('withholding') || feeType.includes('ica') || feeType.includes('fuente')) {
                            reportedTax += Number(fd.amount) || 0;
                        }
                    }
                }

                if ((pType === 'debit_card' || pType === 'credit_card') && paidAmt > 0) {
                    const calculatedTax = Math.round(paidAmt * 0.01913975279);
                    paymentTaxes += Math.max(reportedTax, calculatedTax);
                } else {
                    paymentTaxes += reportedTax;
                }
            }
        }
        if (paymentTaxes > totalTaxes) {
            totalTaxes = paymentTaxes;
        }
    }

    return Math.round(totalTaxes);
}

function getMLFeeAmount(orderData) {
    let itemsFee = 0;
    if (Array.isArray(orderData.order_items)) {
        for (const item of orderData.order_items) {
            let itemFee = Number(item.sale_fee) || Number(item.fee_amount) || 0;

            if (itemFee === 0 && item.unit_price) {
                const qty = Number(item.quantity) || 1;
                const itemTotal = (Number(item.unit_price) || 0) * qty;
                const listingType = String(item.listing_type_id || item.item?.listing_type_id || '').toLowerCase();

                let rate = 0;
                if (listingType.includes('pro') || listingType.includes('premium')) {
                    rate = 0.165;
                } else if (listingType.includes('gold') || listingType.includes('special') || listingType.includes('clasica')) {
                    rate = 0.12;
                } else if (itemTotal > 0) {
                    rate = 0.12;
                }

                if (rate > 0) {
                    itemFee = Math.round(itemTotal * rate);
                    if (Number(item.unit_price) < 90000) {
                        itemFee += (2800 * qty);
                    }
                }
            }

            if (itemFee > 0) itemsFee += itemFee;
        }
    }

    let paymentsFee = 0;
    const payments = Array.isArray(orderData.payments) ? orderData.payments : (orderData.id ? [orderData] : []);
    for (const p of payments) {
        if (p.status === 'approved' || !p.status) {
            let paymentFee = Number(p.marketplace_fee) || 0;

            if (Array.isArray(p.fee_details)) {
                for (const fd of p.fee_details) {
                    const feeType = (fd.fee_type || fd.type || '').toLowerCase();
                    if (
                        feeType.includes('mercadolibre') || 
                        feeType.includes('marketplace') || 
                        feeType.includes('fee') || 
                        feeType.includes('comision') || 
                        feeType.includes('cargo') || 
                        feeType.includes('sale')
                    ) {
                        if (
                            !feeType.includes('tax') && 
                            !feeType.includes('retencion') && 
                            !feeType.includes('withholding') && 
                            !feeType.includes('bonus') && 
                            !feeType.includes('bonific') && 
                            !feeType.includes('subsidy') && 
                            !feeType.includes('rebate')
                        ) {
                            paymentFee += Number(fd.amount) || 0;
                        }
                    }
                }
            }

            if (Array.isArray(p.charges_details)) {
                for (const cd of p.charges_details) {
                    const name = (cd.name || cd.type || '').toLowerCase();
                    if (name.includes('fee') || name.includes('mercadolibre') || name.includes('comision') || name.includes('cargo')) {
                        if (!name.includes('tax') && !name.includes('retencion') && !name.includes('withholding')) {
                            const amt = Number(cd.amounts?.original) || Number(cd.amount) || 0;
                            paymentFee += amt;
                        }
                    }
                }
            }

            if (paymentFee > paymentsFee) paymentsFee = paymentFee;
        }
    }

    return Math.round(Math.max(itemsFee, paymentsFee));
}

        // --- CÁLCULO DE VALOR NETO RECIBIDO Y DEDUCCIONES/COMISIONES ---
        let grossTotal = Math.round(Number(orderData.total_amount) || 0);
        if (grossTotal === 0 && Array.isArray(orderData.order_items)) {
            for (const item of orderData.order_items) {
                grossTotal += Math.round((Number(item.unit_price) || 0) * (Number(item.quantity) || 1));
            }
        }

        // 1. Costo o Bonificación de Envío Vendedor
        let sellerShippingCost = 0;
        if (orderData.shipping && orderData.shipping.id) {
            sellerShippingCost = await getMLShipmentCost(orderData.shipping.id, ML_TOKEN, db, 'mercadolibre_store3');
        } else if (orderData.shipping && Number(orderData.shipping.cost) > 0) {
            sellerShippingCost = Math.round(Number(orderData.shipping.cost));
        }

        let mlShippingBonus = extractMLShippingBonus(orderData, rawShipment);

        // 2. Impuestos / Retenciones ML
        let mlTaxes = Math.round(getMLTaxesAmount(orderData));

        // 3. Comisión por venta
        let mlFee = Math.round(getMLFeeAmount(orderData));

        // 4. CONSULTA FINANCIERA PROFUNDA
        if (Array.isArray(orderData.payments)) {
            for (const p of orderData.payments) {
                if (p.status === 'approved' && p.id) {
                    try {
                        let deepPayment = null;
                        try {
                            deepPayment = await fetchML(`/collections/${p.id}`, ML_TOKEN, db, 'mercadolibre_store3');
                        } catch (cErr) {
                            try {
                                deepPayment = await fetchML(`/v1/payments/${p.id}`, ML_TOKEN, db, 'mercadolibre_store3');
                            } catch (vErr) {}
                        }
                        if (deepPayment) {
                            console.log(`💳 DEEP PAYMENT JSON (${p.id}):`, JSON.stringify(deepPayment));
                            const deepTax = Math.round(getMLTaxesAmount(deepPayment));
                            if (deepTax > mlTaxes) mlTaxes = deepTax;
                            
                            const deepFee = Math.round(getMLFeeAmount(deepPayment));
                            if (deepFee > mlFee) mlFee = deepFee;
                        }
                    } catch (pErr) {
                        console.log(`Info: No se pudo consultar detalles extendidos del pago ${p.id}:`, pErr.message);
                    }
                }
            }
        }

        // FÓRMULA FINAL EXACTA (COP)
        let netAmount = Math.max(0, Math.round(grossTotal - mlFee - sellerShippingCost - mlTaxes + mlShippingBonus));
        let totalDeductions = Math.max(0, grossTotal - netAmount);
        const priceRatio = grossTotal > 0 ? (netAmount / grossTotal) : 1;

        // --- ARMAR LOS ITEMS ---
        let itemsToDeduct = [];
        let dbItems = [];
        
        for (const item of orderData.order_items) {
            const mlEAN = item.item.seller_sku; 
            const qty = Number(item.quantity) || 1;
            
            const foundProduct = await findProductInStore(db, item);

            if (foundProduct) {
                itemsToDeduct.push({ ...foundProduct, qty });
            }

            let grossItemPrice = Number(item.unit_price) || 0;
            let netItemPrice = Math.round(grossItemPrice * priceRatio);
            let itemImage = (foundProduct && foundProduct.image) ? foundProduct.image : (item.item.thumbnail || item.item.picture_url || "");
            let itemSku = (foundProduct && foundProduct.sku) ? foundProduct.sku : (mlEAN ? String(mlEAN) : "");

            dbItems.push({
                id: foundProduct ? foundProduct.docId : `ML3-UNKNOWN-${mlEAN || item.item.id || 'NO_SKU'}`,
                name: (foundProduct && foundProduct.name) ? foundProduct.name : (item.item.title || "Producto MercadoLibre 3"),
                price: netItemPrice,
                quantity: qty,
                color: (foundProduct && foundProduct.color) ? String(foundProduct.color) : "",
                capacity: (foundProduct && foundProduct.capacity) ? String(foundProduct.capacity) : "",
                sku: itemSku,
                image: itemImage,
                mainImage: itemImage,
                thumbnail: itemImage
            });
        }

        // --- DETECCIÓN Y AGRUPACIÓN AUTOMÁTICA DE PACKS / CARRITO CONSOLIDADO ---
        let existingPackDocSnap = null;
        if (orderData.pack_id) {
            const packQ = await db.collection('orders').where('pack_id', '==', String(orderData.pack_id)).limit(1).get();
            if (!packQ.empty && packQ.docs[0].id !== orderId) {
                existingPackDocSnap = packQ.docs[0];
            }
        }
        if (!existingPackDocSnap && orderData.shipping && orderData.shipping.id) {
            const shipQ = await db.collection('orders').where('shippingId', '==', String(orderData.shipping.id)).limit(1).get();
            if (!shipQ.empty && shipQ.docs[0].id !== orderId) {
                existingPackDocSnap = shipQ.docs[0];
            }
        }

        // --- TRANSACCIÓN SEGURA ---
        await db.runTransaction(async (t) => {
            // --- 1. LECTURAS (READS) PRIMERO ---
            const orderRef = db.collection('orders').doc(orderId);
            const currentOrderDoc = await t.get(orderRef);

            if (currentOrderDoc.exists) {
                const cod = currentOrderDoc.data();
                if (cod.isStockDeducted === true && cod.status !== 'CANCELADO') {
                    console.log(`🔒 Orden ${orderId} ya procesada concurrentemente. Evitando descuento duplicado.`);
                    return;
                }
            }

            let freshPackDoc = null;
            if (existingPackDocSnap) {
                freshPackDoc = await t.get(existingPackDocSnap.ref);
                if (freshPackDoc.exists) {
                    const fpd = freshPackDoc.data();
                    if (Array.isArray(fpd.packOrderIds) && fpd.packOrderIds.includes(String(orderData.id))) {
                        console.log(`🔒 Orden ML3 #${orderData.id} ya existe en paquete ${existingPackDocSnap.id}. Evitando duplicación.`);
                        return;
                    }
                }
            }

            const accQ = await t.get(db.collection('accounts').where('name', 'in', ["MercadoLibre 3","MercadoLibre3","Mercado Libre 3","MercadoLibre"]).limit(1));
            let accDoc = null, accId = null, accName = 'MercadoLibre 3';
            if (!accQ.empty) {
                accDoc = accQ.docs[0];
                accId = accDoc.id;
                accName = accDoc.data().name || 'MercadoLibre 3';
            }

            const pDocsMap = new Map();
            for (const p of itemsToDeduct) {
                if (!pDocsMap.has(p.docId)) {
                    const pRef = db.collection('products').doc(p.docId);
                    const pDoc = await t.get(pRef);
                    if (pDoc.exists) {
                        pDocsMap.set(p.docId, pDoc);
                    }
                }
            }

            // --- 2. ESCRITURAS (WRITES) DESPUÉS ---
            if (accDoc) {
                t.update(accDoc.ref, { balance: (Number(accDoc.data().balance) || 0) + netAmount });
            }

            for (const p of itemsToDeduct) {
                const pDoc = pDocsMap.get(p.docId);
                if (pDoc) {
                    const pData = pDoc.data();
                    const qty = Number(p.qty) || 1;

                    let rootBranchStock = { ...(pData.branchStock || {}) };
                    let newCombinations = Array.isArray(pData.combinations) ? JSON.parse(JSON.stringify(pData.combinations)) : [];

                    if (p.isVariant && newCombinations.length > 0 && newCombinations[p.variantIndex]) {
                        let combo = newCombinations[p.variantIndex];
                        if (!combo.branchStock) combo.branchStock = {};

                        let currentBodega = combo.branchStock['bodega'] !== undefined
                            ? (Number(combo.branchStock['bodega']) || 0)
                            : Math.max(0, (Number(combo.stock) || 0) - Object.entries(combo.branchStock).filter(([k]) => k !== 'bodega').reduce((s, [, v]) => s + (Number(v) || 0), 0));

                        combo.branchStock['bodega'] = Math.max(0, currentBodega - qty);
                        combo.stock = Object.values(combo.branchStock).reduce((s, v) => s + (Number(v) || 0), 0);

                        rootBranchStock = {};
                        newCombinations.forEach(c => {
                            if (c.branchStock) {
                                Object.keys(c.branchStock).forEach(bId => {
                                    rootBranchStock[bId] = (rootBranchStock[bId] || 0) + (Number(c.branchStock[bId]) || 0);
                                });
                            }
                        });
                    } else {
                        let currentBodega = rootBranchStock['bodega'] !== undefined
                            ? (Number(rootBranchStock['bodega']) || 0)
                            : Math.max(0, (Number(pData.stock) || 0) - Object.entries(rootBranchStock).filter(([k]) => k !== 'bodega').reduce((s, [, v]) => s + (Number(v) || 0), 0));

                        rootBranchStock['bodega'] = Math.max(0, currentBodega - qty);
                    }

                    let calculatedGlobalStock = Object.values(rootBranchStock).reduce((s, v) => s + (Number(v) || 0), 0);
                    if (newCombinations.length > 0) {
                        calculatedGlobalStock = newCombinations.reduce((s, c) => s + (Number(c.stock) || 0), 0);
                    }

                    t.update(pDoc.ref, {
                        stock: calculatedGlobalStock,
                        branchStock: rootBranchStock,
                        combinations: newCombinations,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }

            if (existingPackDocSnap) {
                const epData = freshPackDoc ? freshPackDoc.data() : existingPackDocSnap.data();
                const combinedItems = [...(epData.items || []), ...dbItems];
                const combinedGross = (Number(epData.grossTotal) || Number(epData.total) || 0) + grossTotal;
                const combinedFee = (Number(epData.mlFee) || 0) + mlFee;
                const combinedTaxes = (Number(epData.mlTaxes) || 0) + mlTaxes;
                const combinedShipping = Math.max(Number(epData.mlShipping) || 0, sellerShippingCost);
                const combinedBonus = (Number(epData.mlShippingBonus) || 0) + mlShippingBonus;
                const combinedNetAmount = Math.max(0, combinedGross - combinedFee - combinedShipping + combinedBonus - combinedTaxes);
                const combinedDeductions = Math.max(0, combinedGross - combinedNetAmount);

                t.update(existingPackDocSnap.ref, {
                    items: combinedItems,
                    grossTotal: combinedGross,
                    mlFee: combinedFee,
                    mlTaxes: combinedTaxes,
                    mlShipping: combinedShipping,
                    mlShippingBonus: combinedBonus,
                    netAmount: combinedNetAmount,
                    total: combinedNetAmount,
                    subtotal: combinedNetAmount,
                    amountPaid: combinedNetAmount,
                    totalDeductions: combinedDeductions,
                    isStockDeducted: true,
                    pack_id: orderData.pack_id ? String(orderData.pack_id) : (epData.pack_id || ""),
                    packOrderIds: admin.firestore.FieldValue.arrayUnion(String(orderData.id)),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                if (accId) {
                    const incRef = db.collection('expenses').doc(`INC-${existingPackDocSnap.id}`);
                    t.set(incRef, {
                        amount: combinedNetAmount,
                        grossAmount: combinedGross,
                        deductions: combinedDeductions,
                        description: `VENTA MERCADOLIBRE 3 #${existingPackDocSnap.id} (PAQUETE CONSOLIDADO ${combinedItems.length} ITEMS)`,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }
            } else {
                if (accId) {
                    const incomeRef = db.collection('expenses').doc(`INC-${orderId}`);
                    t.set(incomeRef, {
                        amount: netAmount,
                        grossAmount: grossTotal,
                        deductions: totalDeductions,
                        category: "Ingreso Ventas Online",
                        description: `VENTA MERCADOLIBRE 3 #${orderData.id}` + (totalDeductions > 0 ? ` (NETO: $${netAmount.toLocaleString('es-CO')})` : ""),
                        paymentMethod: accName, type: 'INCOME', orderId: orderId,
                        supplierName: buyerInfo.name, date: admin.firestore.FieldValue.serverTimestamp(),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    }, { merge: true });
                }

                const orderRef = db.collection('orders').doc(orderId);
                t.set(orderRef, {
                    source: 'MERCADOLIBRE_3',
                    channel: 'MERCADOLIBRE_3',
                    origin: 'MERCADOLIBRE_3',
                    salesChannel: 'MERCADOLIBRE_3',
                    orderType: 'MERCADOLIBRE_3',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    userId: userId,
                    userName: buyerInfo.name,
                    buyerInfo: {
                        name: buyerInfo.name,
                        document: buyerInfo.doc,
                        phone: buyerInfo.phone,
                        email: buyerInfo.email,
                        address: buyerInfo.address,
                        city: buyerInfo.city,
                        department: buyerInfo.department
                    },
                    phone: buyerInfo.phone,
                    clientDoc: buyerInfo.doc,
                    address: buyerInfo.address,
                    city: buyerInfo.city,
                    department: buyerInfo.department,
                    shippingData: {
                        name: buyerInfo.name,
                        clientDoc: buyerInfo.doc,
                        phone: buyerInfo.phone,
                        address: buyerInfo.address,
                        city: buyerInfo.city,
                        department: buyerInfo.department,
                        guideNumber: buyerInfo.guideNumber,
                        carrier: buyerInfo.carrier
                    },
                    shippingCarrier: buyerInfo.carrier,
                    shippingTracking: buyerInfo.guideNumber,
                    shippingId: orderData.shipping && orderData.shipping.id ? String(orderData.shipping.id) : "",
                    pack_id: orderData.pack_id ? String(orderData.pack_id) : "",
                    mlStore: 3,
                    items: dbItems,
                    subtotal: netAmount,
                    shippingCost: 0,
                    total: netAmount,
                    amountPaid: netAmount,
                    grossTotal: grossTotal,
                    netAmount: netAmount,
                    mlFee: mlFee,
                    mlShipping: sellerShippingCost,
                    mlShippingBonus: mlShippingBonus,
                    mlTaxes: mlTaxes,
                    totalDeductions: totalDeductions,
                    status: 'PENDIENTE',
                    paymentMethod: 'MERCADOLIBRE_3',
                    paymentStatus: 'PAID',
                    isStockDeducted: true,
                    paymentAccountId: accId
                });
            }
        });

        console.log(`✅ Orden ${orderId} (Tienda 3) procesada y guardada correctamente.`);
        return res.status(200).send(`OK: Orden ${orderId} procesada con éxito.`);

    } catch (error) {
        console.error("❌ Error en Webhook de MercadoLibre 3:", error);
        return res.status(500).send(`Error procesando webhook ML3: ${error.message}`);
    }
};

// ============================================================================
// 2. CRON JOB: AUTO-RENOVACIÓN DE TOKEN (TIENDA 3)
// ============================================================================
exports.renewTokenTask = async () => {
    const db = admin.firestore();
    const docRef = db.collection('config').doc('mercadolibre_store3');
    const mlConfig = await getMLConfig(db);
    
    try {
        const docSnap = await docRef.get();
        if (!docSnap.exists) return;

        const data = docSnap.data();
        let currentRefreshToken = data.refreshToken || data.refresh_token;

        if (!currentRefreshToken) {
            const devDoc = await db.collection('config').doc('developer').get();
            if (devDoc.exists) {
                const dData = devDoc.data();
                currentRefreshToken = dData.refreshToken_store3 || dData.ML_REFRESH_TOKEN_3;
            }
        }

        if (!currentRefreshToken) return;

        console.log("🔄 Solicitando nuevo token a MercadoLibre 3...");

        const response = await fetch("https://api.mercadolibre.com/oauth/token", {
            method: "POST",
            headers: {
                "accept": "application/json",
                "content-type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: mlConfig.appId,
                client_secret: mlConfig.clientSecret,
                refresh_token: currentRefreshToken
            })
        });

        const result = await response.json();
        if (!response.ok) throw new Error(`Fallo al renovar ML3: ${JSON.stringify(result)}`);

        await docRef.set({
            accessToken: result.access_token,
            refreshToken: result.refresh_token,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        await db.collection('config').doc('developer').set({
            ML_ACCESS_TOKEN_3: result.access_token,
            ML_REFRESH_TOKEN_3: result.refresh_token
        }, { merge: true });

        await db.collection('config').doc('services_status').set({
            ml3: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log("✅ Token de MercadoLibre 3 renovado con éxito.");
    } catch (error) {
        console.error("❌ Error Crítico renovando token de ML3:", error);
    }
};

exports.refreshMLAccessToken = refreshMLAccessToken;
exports.autoRenewToken = refreshMLAccessToken;
