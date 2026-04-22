const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const sharp = require("sharp"); // 🔥 NUEVA LIBRERÍA DE CONVERSIÓN
const db = admin.firestore();
const storage = admin.storage();

// --- CONFIGURACIÓN ---
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// Memoria caché para no convertir la misma imagen 500 veces en campañas masivas
const convertedImageCache = {}; 

// --- HELPERS ---

// 🔥 NUEVO: Convertidor sobre la marcha (WebP a JPG)
async function getMetaCompatibleUrl(mediaUrl) {
    if (!mediaUrl) return null;
    
    // Si la URL no contiene .webp, asumimos que es segura y la pasamos directo
    if (!mediaUrl.includes('.webp')) return mediaUrl;

    // Si ya la convertimos en esta sesión, devolvemos la URL convertida al instante
    if (convertedImageCache[mediaUrl]) return convertedImageCache[mediaUrl];

    console.log(`🔄 Convirtiendo imagen WebP a JPG para Meta: ${mediaUrl}`);
    
    try {
        // 1. Descargar la imagen original
        const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');

        // 2. Convertir a JPEG
        const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();

        // 3. Subir a una carpeta temporal en Storage
        const fileName = `meta_cache/${Date.now()}_converted.jpg`;
        const file = storage.bucket().file(fileName);
        
        await file.save(jpegBuffer, { metadata: { contentType: 'image/jpeg' } });
        await file.makePublic();

        const newUrl = file.publicUrl();
        convertedImageCache[mediaUrl] = newUrl; // Guardar en caché local
        
        console.log(`✅ Imagen convertida con éxito: ${newUrl}`);
        return newUrl;
    } catch (error) {
        console.error("❌ Error convirtiendo imagen para Meta:", error.message);
        return mediaUrl; // Si algo falla, pasamos la original (plan de contingencia)
    }
}

// 1. Enviar mensaje a Meta
async function sendToMeta(phoneNumber, message, type = 'text', mediaUrl = null, templateName = null, templateLang = 'en_US') {
    const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;
    let body = { 
        messaging_product: 'whatsapp', 
        to: phoneNumber, 
        type: type 
    };

    if (type === 'image') {
        body.image = { link: mediaUrl, caption: message || "" };
    } else if (type === 'document') {
        // 🔥 NUEVO: Soporte para PDFs y Archivos
        body.document = { link: mediaUrl, filename: message || "Documento" };
    } else if (type === 'template') {
        body.template = { 
            name: templateName, 
            language: { code: templateLang } 
        };
    } else if (type === 'audio') {
        body.audio = { link: mediaUrl };
    } else {
        body.text = { body: message };
    }

    try {
        const response = await axios.post(url, body, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        return response.data.messages[0].id;
    } catch (error) {
        console.error("Error Meta API:", error.response?.data || error.message);
        throw new Error(error.response?.data?.error?.message || "Fallo al enviar mensaje a WhatsApp");
    }
}

// 2. Descargar y subir multimedia entrante
async function downloadAndUploadMedia(mediaId, mimeType, phoneNumber) {
    try {
        const metaRes = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });
        const fileRes = await axios.get(metaRes.data.url, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });

        const ext = mimeType.split('/')[1].split(';')[0] || 'bin';
        const fileName = `chats/${phoneNumber}/${Date.now()}_${mediaId}.${ext}`;
        const file = storage.bucket().file(fileName);

        await file.save(fileRes.data, { metadata: { contentType: mimeType } });
        await file.makePublic();
        return file.publicUrl();
    } catch (error) {
        console.error("Error media:", error);
        return null;
    }
}

// --- WEBHOOK (RECIBIR + BOT) ---
exports.webhook = onRequest({ timeoutSeconds: 60 }, async (req, res) => {
    if (req.method === "GET") {
        if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
            console.log("✅ Webhook verificado por Meta correctamente.");
            res.status(200).send(req.query["hub.challenge"]);
        } else {
            res.sendStatus(403);
        }
        return;
    }

    if (req.method === "POST") {
        const body = req.body;

        if (body.object) {
            const change = body.entry?.[0]?.changes?.[0]?.value;

            // ESCENARIO 1: Mensaje entrante
            if (change?.messages) {
                const message = change.messages[0];
                const phoneNumber = message.from;
                const userName = change.contacts?.[0]?.profile?.name || "Usuario";
                const type = message.type;
                
                let content = "";
                let mediaUrl = null;

                try {
                    if (type === "text") {
                        content = message.text.body;
                    } else if (type === "image") {
                        content = message.image.caption || "📷 Imagen recibida";
                        mediaUrl = await downloadAndUploadMedia(message.image.id, message.image.mime_type, phoneNumber);
                    } else if (type === "audio") {
                        content = "🎤 Audio recibido";
                        mediaUrl = await downloadAndUploadMedia(message.audio.id, message.audio.mime_type, phoneNumber);
                    } else if (type === "sticker") {
                        content = "🌟 Sticker";
                        mediaUrl = await downloadAndUploadMedia(message.sticker.id, message.sticker.mime_type, phoneNumber);
                    } else if (type === "document") {
                        // 🔥 NUEVO: Recibir PDFs de clientes
                        content = message.document.filename || "📄 Documento recibido";
                        mediaUrl = await downloadAndUploadMedia(message.document.id, message.document.mime_type, phoneNumber);
                    } else if (type === "location") {
                        const lat = message.location.latitude;
                        const lng = message.location.longitude;
                        content = `📍 Ubicación: ${message.location.name || ""} ${message.location.address || ""}`.trim();
                        mediaUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                    } else if (type === "contacts") {
                        const contactPhone = message.contacts[0].phones?.[0]?.wa_id || message.contacts[0].phones?.[0]?.phone || "0";
                        content = `👤 Contacto: ${message.contacts[0].name?.formatted_name || "Contacto"}`;
                        mediaUrl = contactPhone.replace(/[^0-9]/g, ''); 
                    } else {
                        content = `[Archivo no soportado: ${type}]`;
                    }

                    const chatRef = db.collection('chats').doc(phoneNumber);
                    const now = new Date();
                    const bogotaHour = parseInt(now.toLocaleString("en-US", {timeZone: "America/Bogota", hour: "numeric", hour12: false}));
                    
                    const isOutOfOffice = bogotaHour >= 20 || bogotaHour < 7; 
                    let autoReplySent = false;

                    if (isOutOfOffice) {
                        const docSnap = await chatRef.get();
                        const lastAutoReply = docSnap.exists ? docSnap.data().lastAutoReply?.toDate() : null;
                        const hoursSinceLast = lastAutoReply ? (now - lastAutoReply) / (1000 * 60 * 60) : 24;

                        if (hoursSinceLast > 12) {
                            const replyText = "Hola 👋, gracias por escribir a PixelTech.\n\n🌙 Nuestro equipo descansa en este momento, pero hemos recibido tu mensaje y te responderemos a primera hora de la mañana.";
                            const replyId = await sendToMeta(phoneNumber, replyText, 'text');
                            
                            await chatRef.collection('messages').add({
                                type: 'outgoing', content: replyText, messageType: 'text',
                                whatsappId: replyId, isAutoReply: true, timestamp: admin.firestore.Timestamp.now()
                            });
                            autoReplySent = true;
                        }
                    }

                    const updateData = {
                        clientName: userName, phoneNumber, lastMessage: content,
                        lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastCustomerInteraction: admin.firestore.FieldValue.serverTimestamp(),
                        unread: true, platform: 'whatsapp', status: 'open'
                    };

                    if (autoReplySent) updateData.lastAutoReply = admin.firestore.FieldValue.serverTimestamp();

                    await chatRef.set(updateData, { merge: true });

                    await chatRef.collection('messages').add({
                        type: 'incoming', content: content, mediaUrl: mediaUrl, messageType: type,
                        whatsappId: message.id, timestamp: admin.firestore.Timestamp.now()
                    });
                    
                } catch (e) { 
                    console.error("❌ [ERROR INTERNO PROCESANDO MENSAJE]:", e); 
                }
            } 
            // ESCENARIO 2: Reporte de Estado (Fallos de Meta)
            else if (change?.statuses) {
                const status = change.statuses[0];
                
                if (status.errors) {
                    console.error("🚫 [META BLOQUEO/ERROR]:", JSON.stringify(status.errors, null, 2));
                    try {
                        const recipientId = status.recipient_id;
                        const msgsSnapshot = await db.collection('chats').doc(recipientId).collection('messages').where('whatsappId', '==', status.id).get();
                        
                        if (!msgsSnapshot.empty) {
                            msgsSnapshot.forEach(docRef => {
                                docRef.ref.update({
                                    error: true,
                                    errorDetails: status.errors[0].message || status.errors[0].title || "Bloqueado por Meta"
                                });
                            });
                        }
                    } catch(e) { console.error("Error al actualizar BD con el fallo:", e); }
                }
            }
        }
        res.sendStatus(200);
    }
});

// --- FUNCIÓN DE ENVÍO MANUAL (PANEL ADMIN) ---
exports.sendMessage = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login requerido.');
    
    const { phoneNumber, message, type, mediaUrl } = request.data;
    
    let agentName = request.auth.token.name;
    if (!agentName) {
        try {
            const userDoc = await db.collection('users').doc(request.auth.uid).get();
            if (userDoc.exists && userDoc.data().name) agentName = userDoc.data().name;
            else agentName = request.auth.token.email.split('@')[0];
        } catch (e) { agentName = request.auth.token.email.split('@')[0]; }
    }
    
    let finalType = type;
    let finalMedia = mediaUrl;
    
    // Filtro 1: Si es un placeholder, mandarlo como texto normal
    if (type === 'image' && (!mediaUrl || mediaUrl.includes('via.placeholder.com'))) {
        finalType = 'text';
        finalMedia = null;
    } 
    // Filtro 2: 🔥 PROCESAR WEBP A JPG SI ES NECESARIO
    else if (type === 'image' && mediaUrl) {
        finalMedia = await getMetaCompatibleUrl(mediaUrl);
    }
    
    try {
        const waId = await sendToMeta(phoneNumber, message, finalType, finalMedia);

        const chatRef = db.collection('chats').doc(phoneNumber);
        
        // 🔥 Dinámico según el tipo
        let previewTxt = `tú: ${message}`;
        if (finalType === 'image') previewTxt = '📷 Imagen enviada';
        if (finalType === 'document') previewTxt = '📄 Documento enviado';

        await chatRef.set({
            lastMessage: previewTxt,
            lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
            unread: false 
        }, { merge: true });

        await chatRef.collection('messages').add({
            type: 'outgoing',
            content: message || (finalType === 'image' ? 'Imagen enviada' : ''),
            mediaUrl: finalMedia || null,
            messageType: finalType || 'text',
            whatsappId: waId,
            timestamp: admin.firestore.Timestamp.now(),
            sentBy: agentName
        });

        return { success: true };
    } catch (error) {
        throw new HttpsError('internal', error.message);
    }
});

// --- PRUEBA DE PLANTILLA ---
exports.sendTestTemplate = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login requerido.');
    try {
        const waId = await sendToMeta(request.data.phoneNumber, null, 'template', null, 'hello_world', 'en_US');
        return { success: true, waId: waId };
    } catch (error) { throw new HttpsError('internal', error.message); }
});

// --- FUNCIÓN DE MARKETING MASIVO (CAMPAÑAS) ---
exports.sendMassTemplate = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login requerido.');
    
    const { phoneNumber, templateName, imageUrl, clientName, customMessage, linkPath } = request.data;
    
    try {
        // 🔥 PROCESAR LA IMAGEN DE LA CAMPAÑA (Solo se procesa 1 vez gracias a la caché)
        const finalImageUrl = await getMetaCompatibleUrl(imageUrl);

        const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;
        
        const body = {
            messaging_product: 'whatsapp',
            to: phoneNumber,
            type: 'template',
            template: {
                name: templateName,
                language: { code: 'es' }, 
                components: [
                    {
                        type: 'header',
                        parameters: [
                            { type: 'image', image: { link: finalImageUrl } }
                        ]
                    },
                    {
                        type: 'body',
                        parameters: [
                            { type: 'text', text: clientName || "Cliente" }, 
                            { type: 'text', text: customMessage || "Promoción especial" } 
                        ]
                    },
                    {
                        type: 'button',
                        sub_type: 'url',
                        index: "0", 
                        parameters: [
                            { type: 'text', text: linkPath }
                        ]
                    }
                ]
            }
        };

        const response = await axios.post(url, body, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' }
        });

        const chatRef = db.collection('chats').doc(phoneNumber);
        await chatRef.set({
            lastMessage: '📢 [Campaña Enviada]',
            lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
            unread: false 
        }, { merge: true });

        await chatRef.collection('messages').add({
            type: 'outgoing',
            content: `📢 *Campaña Masiva:*\n${customMessage}\n🔗 URL: /${linkPath}`,
            mediaUrl: finalImageUrl,
            messageType: 'template',
            whatsappId: response.data.messages[0].id,
            timestamp: admin.firestore.Timestamp.now()
        });

        return { success: true, waId: response.data.messages[0].id };
    } catch (error) {
        console.error("❌ Error Meta API (Campaña Masiva):", JSON.stringify(error.response?.data || error.message));
        throw new HttpsError('internal', error.response?.data?.error?.message || "Fallo al enviar campaña a Meta");
    }
});