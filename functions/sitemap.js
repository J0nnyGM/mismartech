const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const DOMAIN = "https://pixeltechcol.com"; 

const escapeXml = (unsafe) => {
    if (!unsafe) return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

exports.sitemap = onRequest({ timeoutSeconds: 60, cors: true }, async (req, res) => {
    try {
        const productsSnap = await admin.firestore()
            .collection('products')
            .where('status', '==', 'active')
            .get();

        const categoriesSnap = await admin.firestore().collection('categories').get();

        let urls = '';
        
        // Usaremos la fecha actual para las páginas estáticas y categorías 
        // (indica que el sitio está vivo y actualizándose hoy)
        const todayIso = new Date().toISOString();

        // 1. Páginas estáticas principales
        const staticPages = [
            { path: '/', priority: '1.0', freq: 'daily' },
            { path: '/shop/catalog.html', priority: '0.9', freq: 'daily' },
            { path: '/shop/search.html', priority: '0.8', freq: 'weekly' }
        ];

        staticPages.forEach(page => {
            urls += `
            <url>
                <loc>${DOMAIN}${page.path}</loc>
                <lastmod>${todayIso}</lastmod>
                <changefreq>${page.freq}</changefreq>
                <priority>${page.priority}</priority>
            </url>`;
        });

        // 2. Categorías
        categoriesSnap.forEach(doc => {
            const data = doc.data();
            if (data.name) {
                const catParam = encodeURIComponent(data.name);
                const loc = escapeXml(`${DOMAIN}/shop/catalog.html?category=${catParam}`);
                urls += `
            <url>
                <loc>${loc}</loc>
                <lastmod>${todayIso}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.8</priority>
            </url>`;
            }
        });

        // 3. Productos (CON EXTENSIÓN DE IMÁGENES)
        productsSnap.forEach(doc => {
            const data = doc.data();
            
            let lastModDate = new Date();
            if (data.updatedAt) {
                lastModDate = data.updatedAt.toDate();
            } else if (data.createdAt) {
                lastModDate = data.createdAt.toDate();
            }

            const loc = escapeXml(`${DOMAIN}/shop/product.html?id=${doc.id}`);
            
            // Buscar la mejor imagen del producto
            let imageUrl = data.mainImage || data.image;
            if (!imageUrl && data.images && data.images.length > 0) {
                imageUrl = data.images[0];
            }

            // Construimos el bloque del producto
            let productBlock = `
            <url>
                <loc>${loc}</loc>
                <lastmod>${lastModDate.toISOString()}</lastmod>
                <changefreq>weekly</changefreq>
                <priority>0.9</priority>`;
                
            // Si el producto tiene imagen, le avisamos a Google Images
            if (imageUrl) {
                productBlock += `
                <image:image>
                    <image:loc>${escapeXml(imageUrl)}</image:loc>
                    <image:title>${escapeXml(data.name)}</image:title>
                </image:image>`;
            }

            productBlock += `
            </url>`;
            
            urls += productBlock;
        });

        // 🔥 NOTA: Agregamos el "xmlns:image" en la cabecera para que Google entienda las imágenes
        const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`.trim(); 

        res.set('Content-Type', 'application/xml; charset=utf-8'); 
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=7200');
        
        res.status(200).send(sitemapXml);

    } catch (error) {
        console.error("Sitemap Error:", error);
        res.status(500).send("Error generating sitemap");
    }
});