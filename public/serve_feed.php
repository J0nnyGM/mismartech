<?php
// 1. Cabeceras: XML y caché de 1 hora para evitar consumo excesivo de Firebase
header('Content-Type: text/xml; charset=utf-8');
header('Cache-Control: public, max-age=3600');

// 2. URL de tu Cloud Function
$function_url = "https://generateproductfeed-wghz2bdqpq-uc.a.run.app";

// 3. Usamos cURL para mayor robustez y saltar bloqueos de directiva allow_url_fopen en cPanel
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $function_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
// Tiempo límite de espera en frío de Firebase (15 segundos)
curl_setopt($ch, CURLOPT_TIMEOUT, 15); 
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

// Encabezados para evitar bloqueos del servidor
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Referer: https://mismartech.com/",
    "Origin: https://mismartech.com"
]);

$xml = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// 4. Salida y control de fallos
if ($http_code == 200 && !empty($xml)) {
    echo $xml;
} else {
    // Si la función falla, devolvemos un XML vacío estructurado para evitar penalizaciones en Google Merchant
    http_response_code(200);
    echo '<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
    <channel>
        <title>MiSmartech Store Feed</title>
        <link>https://mismartech.com/</link>
        <description>Feed temporal vacío por mantenimiento técnico.</description>
    </channel>
</rss>';
}
?>