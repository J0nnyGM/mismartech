<?php
// 1. Cabeceras: Le decimos a Google que es XML y que puede guardar esto en memoria por 1 hora
header('Content-Type: application/xml; charset=utf-8');
header('Cache-Control: public, max-age=3600');

// 2. URL de tu Cloud Function
$function_url = "https://sitemap-muiondpggq-uc.a.run.app";

// 3. Usamos cURL para saltar los bloqueos de seguridad de cPanel
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $function_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
// Le damos hasta 15 segundos de paciencia por si Firebase está en "Cold Start"
curl_setopt($ch, CURLOPT_TIMEOUT, 15); 
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

// Simulamos que somos tu propio servidor para evitar bloqueos
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Referer: https://pixeltechcol.com/",
    "Origin: https://pixeltechcol.com"
]);

$xml = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// 4. Si todo salió perfecto, imprimimos el XML
if ($http_code == 200 && !empty($xml)) {
    echo $xml;
} else {
    // Si Firebase falla, entregamos un Sitemap vacío válido en vez de un error 500.
    // Esto evita que Google te penalice si justo escanea cuando hay un micro-corte.
    http_response_code(200);
    echo '<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>https://pixeltechcol.com/</loc>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>';
}
?>