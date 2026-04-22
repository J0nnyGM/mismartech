// functions/local-inventory.js
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

// 🔥 IMPORTANTE: Este código debe coincidir con el "Código de tienda" en Google Mi Negocio
const STORE_CODE = "03889977233892639617"; 

exports.generateLocalInventoryFeed = onRequest({ timeoutSeconds: 60, cors: true }, async (req, res) => {
    try {
        const db = admin.firestore();
        // Usamos una caché separada para no interferir con el feed online
        const cacheRef = db.collection('config').doc('local_inventory_feed_cache');

        console.log("Generando Feed de Inventario Local (Con función ODTO)...");

        // 1. Leer Diccionario Caché
        const cacheSnap = await cacheRef.get();
        let xmlMap = {};
        let lastGenerated = 0;

        if (cacheSnap.exists && req.query.rebuild !== 'true') {
            const data = cacheSnap.data();
            xmlMap = data.xmlMap || {};
            lastGenerated = data.lastGenerated || 0;
        } else {
            console.log("Forzando rebuild del Feed Local.");
        }

        // 2. Buscar productos modificados
        const changedSnap = await db.collection('products')
            .where('updatedAt', '>', new Date(lastGenerated))
            .get();

        if (changedSnap.empty && req.query.rebuild !== 'true') {
            console.log("⚡ 0 cambios. Sirviendo Feed Local desde Caché.");
        } else {
            console.log(`🔄 Actualizando ${changedSnap.size} productos locales...`);

            changedSnap.forEach(docSnap => {
                const p = docSnap.data();
                const baseId = docSnap.id;

                // Si está inactivo, lo borramos del inventario local
                if (p.status !== 'active') {
                    delete xmlMap[baseId];
                    return; 
                }

                if (!p.name || !p.price) return;

                // FUNCIÓN GENERADORA DE ITEMS LOCALES
                const generateLocalItemXml = (variantId, currentPrice, originalPrice, stockNum) => {
                    const numCurrentPrice = Number(currentPrice) || 0;
                    const numOriginalPrice = Number(originalPrice) || 0;
                    const exactStock = Math.max(0, parseInt(stockNum) || 0);

                    let priceXml = '';
                    if (numOriginalPrice > numCurrentPrice) {
                        priceXml = `\n                <g:price>${numOriginalPrice} COP</g:price>\n                <g:sale_price>${numCurrentPrice} COP</g:sale_price>`;
                    } else {
                        priceXml = `\n                <g:price>${numCurrentPrice} COP</g:price>`;
                    }

                    // 🔥 LA MAGIA ODTO (On Display To Order) ESTÁ AQUÍ 🔥
                    // Si el stock es mayor a 0, está "en stock". 
                    // Si es 0 (pero el producto está activo), lo marcamos como "expuesto en tienda".
                    const availability = exactStock > 0 ? 'in_stock' : 'on_display_to_order';

                    // Feed Local: exige store_code, id, quantity, price y ahora availability
                    return `
            <item>
                <g:store_code>${STORE_CODE}</g:store_code>
                <g:id>${variantId}</g:id>
                <g:quantity>${exactStock}</g:quantity>
                <g:availability>${availability}</g:availability>${priceXml}
            </item>`;
                };

                let productXmlBlock = '';

                if (p.isSimple || !p.combinations || p.combinations.length === 0) {
                    productXmlBlock += generateLocalItemXml(baseId, p.price, p.originalPrice, p.stock);
                } else {
                    p.combinations.forEach(combo => {
                        const variantId = combo.sku || `${baseId}_${combo.color || 'x'}_${combo.capacity || 'y'}`.replace(/\s+/g, '');
                        let originalPrice = p.originalPrice || 0;
                        productXmlBlock += generateLocalItemXml(variantId, combo.price, originalPrice, combo.stock);
                    });
                }

                xmlMap[baseId] = productXmlBlock;
            });

            await cacheRef.set({
                xmlMap: xmlMap,
                lastGenerated: Date.now()
            });
        }

        const allItemsXml = Object.values(xmlMap).join('');

        const feedXml = `<?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
                <channel>
                    <title>Inventario Local - PixelTech Col</title>
                    <link>https://pixeltechcol.com</link>
                    <description>Inventario físico en la tienda de Bogotá</description>
                    ${allItemsXml}
                </channel>
            </rss>`;

        res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.status(200).send(feedXml);

    } catch (error) {
        console.error("Error generando feed local:", error);
        res.status(500).send("Error generando el feed local.");
    }
});