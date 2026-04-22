// functions/google-merchant.js
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const DOMAIN = "https://pixeltechcol.com"; 

function escapeXml(unsafe) {
    if (!unsafe) return "";
    return unsafe.toString().replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

function getIdentifierTags(rawSku) {
    if (!rawSku || rawSku.trim() === '') return '<g:identifier_exists>no</g:identifier_exists>';
    const cleanSku = rawSku.replace(/\s|-/g, '');
    const isBarcode = /^\d{8}$|^\d{12,14}$/.test(cleanSku);

    if (isBarcode) {
        return `\n                <g:gtin>${escapeXml(cleanSku)}</g:gtin>\n                <g:identifier_exists>yes</g:identifier_exists>`;
    } else {
        return `\n                <g:mpn>${escapeXml(rawSku)}</g:mpn>\n                <g:identifier_exists>yes</g:identifier_exists>`;
    }
}

exports.generateProductFeed = onRequest({ timeoutSeconds: 60, cors: true }, async (req, res) => {
    try {
        const db = admin.firestore();
        const cacheRef = db.collection('config').doc('merchant_feed_cache');

        console.log("Generando feed PRO (Modo: Delta Cache) con Stock...");

        // 1. Obtener Configuración de Envíos desde tu módulo shipping
        const shippingDoc = await db.collection('config').doc('shipping').get();
        let defaultShippingPrice = 0;
        let freeThreshold = 0;

        if (shippingDoc.exists) {
            const shipData = shippingDoc.data();
            defaultShippingPrice = Number(shipData.defaultPrice) || 0;
            freeThreshold = Number(shipData.freeThreshold) || 0;
        }

        // 2. Leer Diccionario Caché
        const cacheSnap = await cacheRef.get();
        let xmlMap = {};
        let lastGenerated = 0;

        // Validamos si se forzó la reconstrucción con ?rebuild=true
        if (cacheSnap.exists && req.query.rebuild !== 'true') {
            const data = cacheSnap.data();
            xmlMap = data.xmlMap || {};
            lastGenerated = data.lastGenerated || 0;
        } else {
            console.log("Forzando rebuild o caché inexistente. Recargando todo.");
        }

        // 3. Buscar productos modificados
        const changedSnap = await db.collection('products')
            .where('updatedAt', '>', new Date(lastGenerated))
            .get();

        if (changedSnap.empty && req.query.rebuild !== 'true') {
            console.log("⚡ 0 cambios detectados. Sirviendo desde Diccionario Caché.");
        } else {
            console.log(`🔄 Actualizando ${changedSnap.size} productos en el diccionario...`);

            changedSnap.forEach(docSnap => {
                const p = docSnap.data();
                const baseId = docSnap.id;

                // Si está borrador o eliminado, lo sacamos del feed
                if (p.status !== 'active') {
                    delete xmlMap[baseId];
                    return; 
                }

                if (!p.name || !p.price) return;

                let rawDesc = p.description || p.name;
                rawDesc = rawDesc.replace(/<[^>]*>?/gm, ' ').replace(/&nbsp;/g, ' ').replace(/\s\s+/g, ' ').trim(); 
                rawDesc += " | Política de Devolución: Únicamente se aceptan devoluciones si el producto presenta daños, defectos de fábrica o llega en mal estado.";
                const description = escapeXml(rawDesc.substring(0, 5000));

                const brand = escapeXml(p.brand || 'PixelTech');
                const productType = p.subcategory ? escapeXml(`${p.category} > ${p.subcategory}`) : escapeXml(p.category || 'Electrónica');

                let saleDateXml = '';
                if (p.originalPrice && p.originalPrice > p.price && p.promoEndsAt) {
                    try {
                        const endDate = p.promoEndsAt.toDate(); 
                        const startDate = new Date(); 
                        saleDateXml = `\n                <g:sale_price_effective_date>${startDate.toISOString()}/${endDate.toISOString()}</g:sale_price_effective_date>`;
                    } catch (e) {}
                }
                // FUNCIÓN GENERADORA MEJORADA CON STOCK EXACTO
                const generateItemXml = (variantId, title, currentPrice, originalPrice, stockNum, color, capacity, images, isVariant, skuCode) => {
                    
                    // 🔥 CORRECCIÓN: Armar el link inyectando tanto el color como la capacidad
                    let link = `${DOMAIN}/shop/product.html?id=${baseId}`;
                    if (color) link += `&color=${encodeURIComponent(color)}`;
                    if (capacity) link += `&capacity=${encodeURIComponent(capacity)}`;
                    
                    const numCurrentPrice = Number(currentPrice) || 0;
                    const numOriginalPrice = Number(originalPrice) || 0;
                    // 🔥 Aseguramos que el stock sea un número válido, si es negativo, lo ponemos en 0
                    const exactStock = Math.max(0, parseInt(stockNum) || 0);

                    let priceXml = '';
                    if (numOriginalPrice > numCurrentPrice) {
                        priceXml = `\n                <g:price>${numOriginalPrice} COP</g:price>\n                <g:sale_price>${numCurrentPrice} COP</g:sale_price>${saleDateXml}`;
                    } else {
                        priceXml = `\n                <g:price>${numCurrentPrice} COP</g:price>`;
                    }

                    const availability = exactStock > 0 ? 'in_stock' : 'out_of_stock';
                    
                    let finalShippingCost = defaultShippingPrice;
                    if (freeThreshold > 0 && numCurrentPrice >= freeThreshold) {
                        finalShippingCost = 0;
                    }

                    let mainImage = images.length > 0 ? escapeXml(images[0]) : '';
                    let additionalImagesXml = '';
                    if (images.length > 1) {
                        images.slice(1, 11).forEach(img => {
                            additionalImagesXml += `\n                <g:additional_image_link>${escapeXml(img)}</g:additional_image_link>`;
                        });
                    }

                    const identifierXml = getIdentifierTags(skuCode);
                    let customLabels = '';
                    if (p.isNewLaunch) customLabels += `\n                <g:custom_label_0>Lanzamiento</g:custom_label_0>`;
                    if (p.isHeroPromo) customLabels += `\n                <g:custom_label_1>Promoción Hero</g:custom_label_1>`;
                    if (exactStock > 0 && exactStock <= 5) customLabels += `\n                <g:custom_label_2>Últimas unidades</g:custom_label_2>`;
                    if (finalShippingCost === 0) customLabels += `\n                <g:custom_label_3>Envío Gratis</g:custom_label_3>`;

                    // 🔥 INYECTAMOS EL INVENTARIO EXACTO PARA GOOGLE (<g:sell_on_google_quantity>)
                    let xml = `
            <item>
                <g:id>${escapeXml(variantId)}</g:id>
                <g:title>${escapeXml(title)}</g:title>
                <g:description>${description}</g:description>
                <g:link>${escapeXml(link)}</g:link>
                ${mainImage ? `<g:image_link>${mainImage}</g:image_link>` : ''}${additionalImagesXml}
                <g:condition>new</g:condition>
                <g:adult>no</g:adult>
                <g:availability>${availability}</g:availability>
                <g:sell_on_google_quantity>${exactStock}</g:sell_on_google_quantity>${priceXml}
                <g:brand>${brand}</g:brand>
                <g:product_type>${productType}</g:product_type>
                <g:google_product_category>222</g:google_product_category>${identifierXml}
                <g:shipping>
                    <g:country>CO</g:country>
                    <g:price>${finalShippingCost} COP</g:price>
                </g:shipping>${customLabels}`;

                    if (isVariant) {
                        xml += `\n                <g:item_group_id>${escapeXml(baseId)}</g:item_group_id>`;
                        if (color) xml += `\n                <g:color>${escapeXml(color)}</g:color>`;
                        if (capacity) xml += `\n                <g:size>${escapeXml(capacity)}</g:size>`; 
                    }

                    xml += `\n            </item>`;
                    return xml;
                };

                let productXmlBlock = '';

                if (p.isSimple || !p.combinations || p.combinations.length === 0) {
                    const allImages = p.images || [];
                    if (p.mainImage && !allImages.includes(p.mainImage)) allImages.unshift(p.mainImage); 
                    const optimizedTitle = `${p.brand ? p.brand + ' ' : ''}${p.name}`.trim().substring(0, 150);
                    productXmlBlock += generateItemXml(baseId, optimizedTitle, p.price, p.originalPrice, p.stock, null, null, allImages, false, p.sku);
                } else {
                    p.combinations.forEach(combo => {
                        const variantId = combo.sku || `${baseId}_${combo.color || 'x'}_${combo.capacity || 'y'}`.replace(/\s+/g, '');
                        let variantTitle = `${p.brand ? p.brand + ' ' : ''}${p.name}`;
                        if (combo.capacity) variantTitle += ` ${combo.capacity}`; 
                        if (combo.color) variantTitle += ` - ${combo.color}`; 
                        variantTitle = variantTitle.trim().substring(0, 150);

                        let variantImages = [];
                        if (combo.color && p.colorImages && p.colorImages[combo.color]) variantImages.push(...p.colorImages[combo.color]);
                        if (p.images) variantImages.push(...p.images);
                        variantImages = [...new Set(variantImages)]; 

                        let originalPrice = p.originalPrice || 0;
                        const variantEAN = combo.sku || p.sku;

                        productXmlBlock += generateItemXml(variantId, variantTitle, combo.price, originalPrice, combo.stock, combo.color, combo.capacity, variantImages, true, variantEAN);
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
                    <title>PixelTech Col SAS</title>
                    <link>${DOMAIN}</link>
                    <description>Catálogo oficial de productos tecnológicos</description>
                    ${allItemsXml}
                </channel>
            </rss>`;

        res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.status(200).send(feedXml);

    } catch (error) {
        console.error("Error generando feed:", error);
        res.status(500).send("Error generando el feed.");
    }
});