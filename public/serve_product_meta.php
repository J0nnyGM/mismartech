<?php
// Le decimos al navegador que esto es HTML válido
header('Content-Type: text/html; charset=utf-8');

// 1. Obtener el ID del producto
$product_id = isset($_GET['id']) ? trim($_GET['id']) : '';
$real_html_path = __DIR__ . '/shop/product.html'; 

if (empty($product_id) || !file_exists($real_html_path)) {
    http_response_code(404);
    echo "Página de producto no encontrada.";
    exit;
}

// -------------------------------------------------------------------
// 🔥 NUEVO: SISTEMA DE CACHÉ DE SERVIDOR (VELOCIDAD EXTREMA) 🔥
// -------------------------------------------------------------------
$cache_dir = __DIR__ . '/cache';
// Si la carpeta de caché no existe, la creamos
if (!is_dir($cache_dir)) {
    @mkdir($cache_dir, 0755, true);
}

// Creamos un nombre de archivo único para este producto
$cache_file = $cache_dir . '/prod_' . md5($product_id) . '.html';
$cache_time = 7200; // 2 horas (7200 segundos)

// Si el caché existe y tiene menos de 2 horas de antigüedad, lo servimos de inmediato
if (file_exists($cache_file) && (time() - filemtime($cache_file)) < $cache_time) {
    // Le avisamos al navegador que esta versión está ultra-optimizada
    header('X-PixelTech-Cache: HIT');
    echo file_get_contents($cache_file);
    exit;
}
header('X-PixelTech-Cache: MISS'); // Si no hay caché, avisamos que tuvimos que consultar
// -------------------------------------------------------------------

// 2. Leemos el HTML original procesando el código PHP interno (Header/Footer)
ob_start(); // Iniciamos el búfer de memoria
include $real_html_path; // Ejecutamos el HTML y sus includes PHP
$html = ob_get_clean(); // Guardamos el resultado ensamblado y limpiamos la memoria

// 3. API REST directa a Firebase
$api_key = "AIzaSyALwLCRjRaWUE5yy5-TBjjxKehguNhb0GU"; 
$api_url = "https://firestore.googleapis.com/v1/projects/pixeltechcol/databases/(default)/documents/products/" . urlencode($product_id) . "?key=" . $api_key;

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_TIMEOUT, 4); 
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Referer: https://pixeltechcol.com/",
    "Origin: https://pixeltechcol.com"
]);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

function parseFirebasePrice($field) {
    if (!$field) return 0;
    if (isset($field['integerValue'])) return floatval($field['integerValue']);
    if (isset($field['doubleValue'])) return floatval($field['doubleValue']);
    if (isset($field['stringValue'])) return floatval(preg_replace('/[^0-9]/', '', $field['stringValue']));
    return 0;
}

// 4. Procesamos la data
if ($http_code == 200 && $response) {
    $data = json_decode($response, true);
    
    if (isset($data['fields'])) {
        $fields = $data['fields'];
        
        $name = isset($fields['name']['stringValue']) ? $fields['name']['stringValue'] : 'Producto';
        $price = parseFirebasePrice($fields['price'] ?? null);
        
        if ($price == 0) {
            $all_prices = [];
            foreach (['combinations', 'capacities', 'variants'] as $arrKey) {
                if (isset($fields[$arrKey]['arrayValue']['values'])) {
                    foreach ($fields[$arrKey]['arrayValue']['values'] as $item) {
                        $p = parseFirebasePrice($item['mapValue']['fields']['price'] ?? null);
                        if ($p > 0) $all_prices[] = $p;
                    }
                }
            }
            if (count($all_prices) > 0) {
                $price = min($all_prices);
            }
        }

        $image = "https://pixeltechcol.com/img/logo.webp";
        if (isset($fields['mainImage']['stringValue'])) {
            $image = $fields['mainImage']['stringValue'];
        } elseif (isset($fields['image']['stringValue'])) {
            $image = $fields['image']['stringValue'];
        } elseif (isset($fields['images']['arrayValue']['values'][0]['stringValue'])) {
            $image = $fields['images']['arrayValue']['values'][0]['stringValue'];
        }
        
        $desc = "Compra $name al mejor precio en PixelTech Colombia. Envíos a todo el país y crédito ADDI.";
        if (isset($fields['description']['stringValue'])) {
            $clean_desc = strip_tags($fields['description']['stringValue']); 
            $clean_desc = trim(preg_replace('/\s\s+/', ' ', $clean_desc)); 
            $desc = mb_substr($clean_desc, 0, 150) . "..."; 
        }
        
        $productUrl = "https://pixeltechcol.com/shop/product.html?id=" . urlencode($product_id);
        
        if ($price > 0) {
            $title = "$" . number_format($price, 0, ',', '.') . " - " . $name . " | PixelTech";
        } else {
            $title = $name . " | PixelTech";
        }

        // --- 5. Construir Meta Etiquetas Dinámicas y Schema (SEO Instantáneo) ---
        
        // Creamos el Schema.org en PHP para que Googlebot vea que es COP al instante
        $schemaData = [
            "@context" => "https://schema.org/",
            "@type" => "Product",
            "name" => $name,
            "image" => [$image],
            "description" => $desc,
            "sku" => $product_id,
            "offers" => [
                "@type" => "Offer",
                "url" => $productUrl,
                "priceCurrency" => "COP", // 👈 AQUÍ FORZAMOS PESOS COLOMBIANOS
                "price" => $price,
                "availability" => "https://schema.org/InStock"
            ]
        ];
        $json_ld = json_encode($schemaData, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $meta_tags = "
    <link rel=\"preload\" as=\"image\" href=\"$image\" fetchpriority=\"high\">
    <title>$title</title>
    <meta name=\"description\" content=\"$desc\">
    <meta property=\"og:type\" content=\"product\">
    <meta property=\"og:url\" content=\"$productUrl\">
    <meta property=\"og:title\" content=\"$title\">
    <meta property=\"og:description\" content=\"$desc\">
    <meta property=\"og:image\" content=\"$image\">
    <meta property=\"og:site_name\" content=\"PixelTech Col\">
    <meta property=\"product:price:amount\" content=\"$price\">
    <meta property=\"product:price:currency\" content=\"COP\">
    <meta name=\"twitter:card\" content=\"summary_large_image\">
    <meta name=\"twitter:title\" content=\"$title\">
    <meta name=\"twitter:description\" content=\"$desc\">
    <meta name=\"twitter:image\" content=\"$image\">
    <script type=\"application/ld+json\" id=\"json-ld-product\">
    $json_ld
    </script>
        ";

        // Escapar signos de dólar para evitar conflictos con preg_replace
        $safe_meta_tags = str_replace('$', '\\$', $meta_tags);
        $html = preg_replace('/<title>.*?<\/title>/is', $safe_meta_tags, $html);
        
        // 🔥 INYECCIÓN DIRECTA DE LA FOTO (Cero retraso de renderización) 🔥
        $safe_image = str_replace('$', '\\$', $image);
        $html = preg_replace('/(<img[^>]*id="p-main-image"[^>]*src=")([^"]*)("[^>]*>)/is', '${1}' . $safe_image . '$3', $html);
        
        // 🔥 INYECCIÓN DIRECTA DEL PRECIO 🔥
        $formatted_price = "$" . number_format($price, 0, ',', '.');
        $html = preg_replace('/(<span[^>]*id="p-price"[^>]*>).*?(<\/span>)/is', '${1}' . $formatted_price . '$2', $html);

        // 🔥 INYECCIÓN DIRECTA DEL NOMBRE DEL PRODUCTO 🔥
        $safe_name = str_replace('$', '\\$', $name);
        $html = preg_replace('/(<h1[^>]*id="p-name"[^>]*>)(.*?)(<\/h1>)/is', '${1}' . $safe_name . '${3}', $html);
        
        // --- NUEVO: Poner el título en la etiqueta <title> ---
        // (Ya no es necesario porque lo incluimos arriba en los meta_tags)
        // $html = preg_replace('/(<title>)(.*?)(<\/title>)/is', '${1}' . $title . '${3}', $html);

        // 🔥 INYECCIÓN DIRECTA DE LA DESCRIPCIÓN 🔥
        if (isset($fields['description']['stringValue'])) {
            $raw_desc = $fields['description']['stringValue'];
            $safe_desc_html = str_replace('$', '\\$', $raw_desc);
            $html = preg_replace('/(<div[^>]*id="p-description"[^>]*>)(.*?)(<\/div>)/is', '${1}' . $safe_desc_html . '${3}', $html);
        }
        
        $preloadedData = json_encode(['id' => $product_id, 'name' => $name, 'price' => $price, 'mainImage' => $image]);
        $safe_preloadedData = str_replace('$', '\\$', $preloadedData);
        $html = str_replace('</head>', "\n<script>window.__PRELOADED_PRODUCT__ = $safe_preloadedData;</script>\n</head>", $html);
        
        // 🔥 GUARDAMOS EN CACHÉ PARA LOS PRÓXIMOS VISITANTES 🔥
        @file_put_contents($cache_file, $html);
    }
}

echo $html;
?>