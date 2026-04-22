const { onDocumentWritten } = require("firebase-functions/v2/firestore");
// Importar admin si no está ya importado arriba
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

// --- TRIGGER: TIMESTAMP AUTOMÁTICO ---
// Si editas un producto y no envías 'last_updated', el servidor lo pone por ti.
exports.touchProductTimestamp = onDocumentWritten("products/{productId}", async (event) => {
    // Si el documento fue borrado, no hacemos nada
    if (!event.data.after.exists) return;

    const newData = event.data.after.data();
    const oldData = event.data.before.exists ? event.data.before.data() : null;

    // Evitar bucle infinito: Si ya tiene last_updated reciente (menos de 10s), paramos.
    const now = admin.firestore.Timestamp.now();
    if (newData.last_updated && newData.last_updated.toMillis() > now.toMillis() - 10000) {
        return;
    }

    // Si algo cambió realmente, actualizamos la fecha
    return event.data.after.ref.set({
        last_updated: now
    }, { merge: true });
});