<?php
// 1. Limpiamos cualquier salida previa que pueda meter el servidor sin querer
if (ob_get_length()) ob_clean();

// 2. Cabeceras estrictas para XML
header('Content-Type: text/xml; charset=utf-8');
header('Cache-Control: public, max-age=3600');

// 3. URL de tu Cloud Function
$function_url = "https://sitemap-wghz2bdqpq-uc.a.run.app";

// 4. Configuración de cURL
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $function_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_TIMEOUT, 15); 
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Referer: https://mismartech.com/",
    "Origin: https://mismartech.com"
]);

$xml = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// 5. Renderizado
if ($http_code == 200 && !empty($xml)) {
    // Eliminamos espacios en blanco y saltos de línea al inicio y final
    echo trim($xml);
    // Forzamos el cierre del script para que cPanel no meta "extra content"
    exit; 
} else {
    // Sitemap de emergencia adaptado al mismo formato de tu función
    http_response_code(200);
    echo '<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
    <url>
        <loc>https://mismartech.com/</loc>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
</urlset>';
    exit;
}