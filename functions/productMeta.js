const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Función auxiliar para convertir cualquier formato raro de Firebase a un número real
function parsePrice(val) {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const cleaned = val.replace(/[^0-9]/g, '');
        return Number(cleaned) || 0;
    }
    return 0;
}

exports.renderProductMeta = async (req, res) => {
    const id = req.query.id;
    if (!id) return res.status(400).send("Falta el ID del producto");

    try {
        const docSnap = await admin.firestore().collection('products').doc(id).get();
        
        if (!docSnap.exists) {
            return res.status(404).send("Producto no encontrado");
        }

        const p = docSnap.data();
        
        // --- 1. LÓGICA DE PRECIO INTELIGENTE ---
        let price = parsePrice(p.price);

        // Si el precio base es 0, buscamos el más barato dentro de las opciones
        if (price === 0) {
            let allPrices = [];
            
            if (p.combinations && Array.isArray(p.combinations)) {
                allPrices.push(...p.combinations.map(c => parsePrice(c.price)));
            }
            if (p.capacities && Array.isArray(p.capacities)) {
                allPrices.push(...p.capacities.map(c => parsePrice(c.price)));
            }
            if (p.variants && Array.isArray(p.variants)) {
                allPrices.push(...p.variants.map(v => parsePrice(v.price)));
            }

            // Filtramos los mayores a 0 y tomamos el mínimo
            const validPrices = allPrices.filter(v => v > 0);
            if (validPrices.length > 0) {
                price = Math.min(...validPrices);
            }
        }

        const priceFormatted = price.toLocaleString('es-CO');
        
        // --- 2. PREPARAR TEXTOS ---
        const finalTitle = `$${priceFormatted} - ${p.name} | PixelTech`;
        let cleanDesc = `Compra ${p.name} al mejor precio en PixelTech Colombia. Envíos a todo el país.`;
        
        if (p.description) {
            cleanDesc = p.description.replace(/<[^>]*>?/gm, ''); // Quita HTML
            cleanDesc = cleanDesc.replace(/\s\s+/g, ' ').trim(); // Quita saltos de línea
            cleanDesc = cleanDesc.substring(0, 150) + "...";
        }
        
        // --- 3. EXTRAER IMAGEN ---
        let image = "https://pixeltechcol.com/img/logo.webp";
        if (p.mainImage) {
            image = p.mainImage;
        } else if (p.image) {
            image = p.image;
        } else if (p.images && p.images.length > 0) {
            image = p.images[0];
        }
        
        const productUrl = `https://pixeltechcol.com/shop/product.html?id=${id}`;

        // --- 4. GENERAR HTML (OPEN GRAPH) ---
        const html = `<!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>${finalTitle}</title>
            <meta name="description" content="${cleanDesc}">
            
            <meta property="og:type" content="product">
            <meta property="og:url" content="${productUrl}">
            <meta property="og:title" content="${finalTitle}">
            <meta property="og:description" content="${cleanDesc}">
            <meta property="og:image" content="${image}">
            <meta property="og:site_name" content="PixelTech Col">
            
            <meta name="twitter:card" content="summary_large_image">
            <meta name="twitter:title" content="${finalTitle}">
            <meta name="twitter:description" content="${cleanDesc}">
            <meta name="twitter:image" content="${image}">
            
            <script>window.location.href = "${productUrl}";</script>
        </head>
        <body>
            <p>Redirigiendo al producto...</p>
        </body>
        </html>`;

        res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        res.status(200).send(html);

    } catch (error) {
        console.error("Error generando meta tags:", error);
        res.status(500).send("Error interno");
    }
};