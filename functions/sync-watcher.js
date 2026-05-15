const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

// Array con los nombres exactos de las colecciones que tu Cerebro (AdminStore) vigila
const COLLECTIONS_TO_WATCH = [
    "products",
    "users",
    "orders",
    "payables",
    "expenses",
    "purchases",
    "warranties",
    "warranty_inventory",
    "accounts"
];

// Generamos un trigger dinámico para cada colección
const watchers = {};

COLLECTIONS_TO_WATCH.forEach(collectionName => {
    // 🔥 USAMOS V2: onDocumentWritten
    watchers[`watch_${collectionName}`] = onDocumentWritten(`${collectionName}/{docId}`, async (event) => {
        
        // Si el documento fue borrado, no hacemos nada (el Store maneja los deletes en RAM)
        if (!event.data || !event.data.after.exists) return null;

        const newData = event.data.after.data();
        const previousData = event.data.before.exists ? event.data.before.data() : null;

        // EVITAR BUCLES INFINITOS:
        const now = admin.firestore.Timestamp.now();
        let needsUpdate = false;

        if (!newData.updatedAt) {
            needsUpdate = true; // Si no tiene la marca de tiempo, se la ponemos
        } else {
            const diffInSeconds = Math.abs(now.seconds - newData.updatedAt.seconds);
            // Solo si la diferencia es mayor a 2 segundos asumimos que fue un cambio real
            if (diffInSeconds > 2) {
                
                // Comparamos los datos sin mirar los timestamps para no entrar en bucle
                const oldStr = JSON.stringify({ ...previousData, updatedAt: null, createdAt: null });
                const newStr = JSON.stringify({ ...newData, updatedAt: null, createdAt: null });

                if (oldStr !== newStr) {
                    needsUpdate = true;
                }
            }
        }

        if (needsUpdate) {
            try {
                // Inyectamos silenciosamente el updatedAt
                await event.data.after.ref.update({
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`[SyncWatcher] ${collectionName}/${event.params.docId} marcado con updatedAt.`);
            } catch (error) {
                console.error(`[SyncWatcher Error] ${collectionName}/${event.params.docId}:`, error);
            }
        }

        return null;
    });
});

module.exports = watchers;