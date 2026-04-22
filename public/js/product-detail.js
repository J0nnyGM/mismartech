import { db, doc, collection, query, where, limit, getDocs, onSnapshot } from './firebase-init.js';
import { addToCart } from './cart.js'; 
import { trackEcommerceEvent } from './global-components.js';

// Estado local
let state = {
    selectedColor: null,
    selectedCapacity: null,
    currentPrice: 0,
    currentStock: 0,
    currentImage: '',
    product: null
};

// Elementos DOM
const els = {
    mainImg: document.getElementById('p-main-image'),
    thumbsContainer: document.getElementById('p-thumbnails'),
    name: document.getElementById('p-name'),
    price: document.getElementById('p-price'),
    oldPrice: document.getElementById('p-old-price'),
    sku: document.getElementById('p-sku-display'),
    qty: document.getElementById('p-qty'),
    loader: document.getElementById('p-loader'),
    content: document.getElementById('p-content'),
    desc: document.getElementById('p-description'),
    
    breadCat: document.getElementById('breadcrumb-cat'),
    breadCatLink: document.getElementById('breadcrumb-cat-link'),
    breadSub: document.getElementById('breadcrumb-sub'),
    breadSubLink: document.getElementById('breadcrumb-sub-link'),
    breadSubSep: document.getElementById('breadcrumb-sub-sep'),
    breadName: document.getElementById('breadcrumb-name'),

    optionsContainer: document.getElementById('p-options'),
    btnAdd: document.getElementById('btn-add-main'),
    whatsappBtn: document.getElementById('whatsapp-buy'),
    discountTag: document.getElementById('p-discount-tag'),
    addiContainer: document.getElementById('addi-widget-container'),
    warrantyText: document.getElementById('p-warranty-text'),
    stockText: document.getElementById('p-stock-text'),
    shippingText: document.getElementById('p-shipping-text'),

    stickyBar: document.getElementById('sticky-bar'),
    stickyPrice: document.getElementById('sticky-price'),
    stickyDiscountRow: document.getElementById('sticky-discount-row'), 
    stickyOldPrice: document.getElementById('sticky-old-price'),     
    stickyBadge: document.getElementById('sticky-discount-badge'),   
    purchaseSection: document.getElementById('purchase-section'),    
    
    relatedSection: document.getElementById('related-products-section'),
    relatedGrid: document.getElementById('related-grid')
};

// 🔥 FUNCIÓN SEO: Transforma la URL para pedir la versión miniatura
function getResizedImageUrl(url) {
    if (!url || !url.includes('firebasestorage')) return url;
    return url.replace(/(\.jpg|\.jpeg|\.png|\.webp)(\?alt=media)/i, '_200x200$1$2');
}

function getProductFromCache(id) {
    try {
        const cachedRaw = localStorage.getItem('pixeltech_master_catalog');
        if (!cachedRaw) return null;
        const cachedData = JSON.parse(cachedRaw);
        const map = cachedData.map || {};
        if (map[id]) {
            return map[id];
        }
    } catch (e) {}
    return null;
}

// Variable global para guardar la lista de imágenes actual
let currentGalleryImages = [];
// Variable para controlar la suscripción en tiempo real y evitar duplicados
let unsubscribeProduct = null;

// LÓGICA DE SWIPE (DESLIZAMIENTO EN MÓVILES)
let swipeInitialized = false;

export async function initProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');

    if (!productId) { window.location.href = '/index.html'; return; }

    // 1. 🔥 HIDRATACIÓN INMEDIATA (Velocidad Extrema) 🔥
    let productData = null;

    if (window.__PRELOADED_PRODUCT__) {
        productData = window.__PRELOADED_PRODUCT__;
        
        // Pintamos lo básico al instante
        els.name.textContent = productData.name;
        els.price.textContent = `$${productData.price.toLocaleString('es-CO')}`;
        
        if(els.mainImg.src === "" || els.mainImg.src.includes('undefined')) {
             els.mainImg.src = productData.mainImage || 'https://placehold.co/500';
        }
        
        if (els.loader) els.loader.classList.add('hidden');
        if (els.content) els.content.classList.remove('hidden');
    }

    // 2. BUSCAR CACHÉ LOCAL
    const cachedProduct = getProductFromCache(productId);
    if (cachedProduct) {
        console.log("⚡ [Detalle] Cargado desde SmartCache");
        productData = cachedProduct;
        renderProductData(productData, productId);
    } 

    let firebaseStarted = false;

    const startFirebaseSync = () => {
        if (firebaseStarted) return;
        firebaseStarted = true;
        
        if (unsubscribeProduct) unsubscribeProduct();
        console.log("☁️ [Detalle] Iniciando Sync con Firebase...");
        
        unsubscribeProduct = onSnapshot(doc(db, "products", productId), (snap) => {
            if (!snap.exists()) {
                document.body.innerHTML = "<div class='flex flex-col items-center justify-center h-screen'><h1 class='text-2xl font-black mb-4'>Producto no encontrado o eliminado 😔</h1><a href='/' class='bg-brand-cyan px-6 py-3 rounded-xl font-bold'>Volver al Inicio</a></div>";
                return;
            }

            const freshData = { id: snap.id, ...snap.data() };
            const isDifferent = !productData || JSON.stringify(productData) !== JSON.stringify(freshData);

            if (isDifferent) {
                console.log("🔥 [Detalle] Actualización detectada.");
                productData = freshData;
                renderProductData(productData, productId);
                updateLocalCacheWith(productData);
            }
        }, (error) => {
            console.error("Error en SmartSync Detalle:", error);
        });
    };

    // 🔥 EN LA PÁGINA DE PRODUCTO, LA DATA ES VITAL: Pedimos las variantes de inmediato sin bloquear.
    if ('requestIdleCallback' in window) {
        requestIdleCallback(startFirebaseSync);
    } else {
        setTimeout(startFirebaseSync, 50);
    }
}

function updateLocalCacheWith(productData) {
    try {
        const STORAGE_KEY = 'pixeltech_master_catalog';
        const cachedRaw = localStorage.getItem(STORAGE_KEY);
        if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw);
            if (parsed.map) {
                parsed.map[productData.id] = productData;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            }
        }
    } catch(e) {}
}

async function renderProductData(p, productId) {
    state.product = p;
    
    // Leer parámetros de la URL para autoseleccionar variantes
    const params = new URLSearchParams(window.location.search);
    const urlColor = params.get('color');
    const urlCapacity = params.get('capacity');

    if (urlColor && p.variants) {
        const foundColor = p.variants.find(v => v.color.toLowerCase() === urlColor.toLowerCase());
        if (foundColor) state.selectedColor = foundColor.color;
    }
    if (urlCapacity && p.capacities) {
        const foundCap = p.capacities.find(c => c.label.toLowerCase() === urlCapacity.toLowerCase());
        if (foundCap) state.selectedCapacity = foundCap.label;
    }

    // 🔥 CORRECCIÓN CRÍTICA: Autoselección de protección 🔥
    // Si la URL trajo solo 1 parámetro (ej. el color) pero el producto requiere 2, 
    // autoseleccionamos el faltante basándonos en el que tenga stock.
    if (p.hasCapacities && !state.selectedCapacity) {
        // Busca la primera capacidad que tenga stock haciendo match con el color seleccionado
        const validCap = p.capacities.find(cap => getStockForVariant(p, state.selectedColor, cap.label) > 0) || p.capacities[0];
        if (validCap) state.selectedCapacity = validCap.label;
    }
    
    if (p.hasVariants && !state.selectedColor) {
        // Busca el primer color que tenga stock haciendo match con la capacidad seleccionada
        const validColor = p.variants.find(v => getStockForVariant(p, v.color, state.selectedCapacity) > 0) || p.variants[0];
        if (validColor) state.selectedColor = validColor.color;
    }

    // Inicializar valores base
    state.currentPrice = p.price;
    state.currentStock = p.stock || 0;
    
    const allImages = [p.mainImage, ...(p.images || [])].filter(Boolean);
    if (!state.currentImage || !allImages.includes(state.currentImage)) {
        state.currentImage = p.mainImage || (p.images && p.images.length > 0 ? p.images[0] : 'https://placehold.co/500');
    }

    document.title = `${p.name} | PixelTech`;
    els.name.textContent = p.name;
    els.desc.innerHTML = p.description || '';

    els.breadName.textContent = p.name;
    if (p.category) {
        els.breadCat.textContent = p.category;
        els.breadCatLink.href = `/shop/search.html?category=${encodeURIComponent(p.category)}`;
    } else {
        els.breadCat.textContent = 'General';
    }
    if (p.subcategory) {
        els.breadSub.textContent = p.subcategory;
        els.breadSubLink.href = `/shop/search.html?category=${encodeURIComponent(p.category)}&subcategory=${encodeURIComponent(p.subcategory)}`;
        els.breadSubLink.classList.remove('hidden');
        els.breadSubSep.classList.remove('hidden');
    }

    if (p.warranty && els.warrantyText) {
        const units = { months: 'Meses', days: 'Días', years: 'Años' };
        const unitText = units[p.warranty.unit] || p.warranty.unit || 'Meses';
        els.warrantyText.textContent = `Garantía directa de ${p.warranty.time} ${unitText} por defectos de fábrica.`;
    }

    trackEcommerceEvent('view_item', {
        currency: "COP",
        value: p.price,
        items: [{ item_id: p.id, item_name: p.name, price: p.price, item_category: p.category }]
    });

    renderOptions(p);
    updatePriceDisplay(); 
    updateGallery();
    
    els.mainImg.src = state.currentImage;
    els.mainImg.alt = `Comprar ${p.name} - ${p.category} en Colombia`;
    await updateShippingText();

    els.whatsappBtn.href = `https://wa.me/573009046450?text=Hola PixelTech, me interesa este producto: ${p.name} (Ref: ${productId})`;
    if (els.loader) els.loader.classList.add('hidden');
    if (els.content) els.content.classList.remove('hidden');
    els.btnAdd.onclick = handleAddToCart;
    initStickyBar(); 
    loadRelatedProductsOptimized(p.category, p.id); 
    
    // Inyectar schema al final con los datos ya actualizados
    injectProductSchema(p);
    updateMetaTags(p);
    saveToHistory(p);
}

async function loadRelatedProductsOptimized(category, currentId) {
    if (!els.relatedSection) return;
    let related = [];
    
    const cachedRaw = localStorage.getItem('pixeltech_master_catalog');
    if (cachedRaw) {
        try {
            const allProducts = Object.values(JSON.parse(cachedRaw).map || {});
            related = allProducts.filter(p => p.category === category && p.status === 'active' && p.id !== currentId);
            if (related.length < 4) {
                const others = allProducts.filter(p => p.category !== category && p.status === 'active' && p.id !== currentId);
                related = [...related, ...others];
            }
        } catch (e) {}
    }

    if (related.length === 0) {
        try {
            let q = query(collection(db, "products"), where("category", "==", category), where("status", "==", "active"), limit(5));
            let snap = await getDocs(q);
            if (snap.empty) {
                q = query(collection(db, "products"), where("status", "==", "active"), limit(5));
                snap = await getDocs(q);
            }
            snap.forEach(d => { if (d.id !== currentId) related.push({ id: d.id, ...d.data() }); });
        } catch (err) { console.error(err); }
    }

    if (related.length === 0) return;
    related.sort(() => 0.5 - Math.random());
    
    els.relatedSection.classList.remove('hidden');
    els.relatedGrid.innerHTML = related.slice(0, 8).map(p => {
        const price = p.price.toLocaleString('es-CO');
        const originalImg = p.mainImage || (p.images && p.images.length > 0 ? p.images[0] : 'https://placehold.co/150');
        const miniaturaImg = getResizedImageUrl(originalImg);
        const hasDiscount = p.originalPrice && p.originalPrice > p.price;
        const discountBadge = hasDiscount ? `<span class="absolute top-3 left-3 bg-brand-red text-white text-[8px] font-black px-2 py-1 rounded shadow-sm z-10">OFERTA</span>` : '';

        return `
            <div class="w-[70vw] sm:w-[calc(50%-8px)] lg:w-[calc(25%-12px)] shrink-0 bg-white rounded-[1.5rem] md:rounded-[2rem] p-3 md:p-4 border border-gray-100 shadow-sm hover:border-brand-cyan/30 hover:shadow-md transition-all cursor-pointer group relative snap-start" onclick="window.location.href='/shop/product.html?id=${p.id}'">
                ${discountBadge}
                <div class="h-32 md:h-36 mb-3 md:mb-4 flex items-center justify-center p-3 bg-slate-50 rounded-[1.2rem] md:rounded-[1.5rem] group-hover:bg-cyan-50/30 transition-colors">
                    <img src="${miniaturaImg}" width="224" height="224" onerror="this.onerror=null; this.src='${originalImg}';" class="max-w-full max-h-full object-contain group-hover:scale-110 transition duration-500 mix-blend-multiply" loading="lazy" alt="${p.name}">
                </div>
                <div class="px-1 md:px-2">
                    <p class="text-[8px] md:text-[9px] font-bold text-gray-400 uppercase tracking-widest truncate mb-1">${p.category}</p>
                    <h4 class="text-[11px] md:text-xs font-black text-brand-black uppercase leading-tight line-clamp-2 h-8 mb-2 group-hover:text-brand-cyan transition">${p.name}</h4>
                    <div class="flex justify-between items-end border-t border-gray-50 pt-2 md:pt-3">
                        <div class="flex flex-col">
                            ${hasDiscount ? `<span class="text-[8px] md:text-[9px] text-gray-300 line-through mb-0.5">$${p.originalPrice.toLocaleString('es-CO')}</span>` : ''}
                            <span class="text-sm md:text-base font-black ${hasDiscount ? 'text-brand-red' : 'text-brand-black'} tracking-tight">$${price}</span>
                        </div>
                        <button class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-brand-black text-white flex items-center justify-center hover:bg-brand-cyan hover:scale-110 transition shadow-lg shadow-black/10"><i class="fa-solid fa-plus text-[10px]"></i></button>
                    </div>
                </div>
            </div>`;
    }).join('');

    const grid = els.relatedGrid;
    let autoScrollInterval;

    const startAutoScroll = () => {
        autoScrollInterval = setInterval(() => {
            if (!grid) return;
            const maxScrollLeft = grid.scrollWidth - grid.clientWidth;
            
            if (grid.scrollLeft >= maxScrollLeft - 10) {
                grid.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                const cardWidth = grid.querySelector('div').offsetWidth + 16; 
                grid.scrollBy({ left: cardWidth, behavior: 'smooth' });
            }
        }, 3500); 
    };

    const stopAutoScroll = () => clearInterval(autoScrollInterval);

    startAutoScroll();

    grid.addEventListener('mouseenter', stopAutoScroll);
    grid.addEventListener('mouseleave', startAutoScroll);
    grid.addEventListener('touchstart', stopAutoScroll, { passive: true });
    grid.addEventListener('touchend', startAutoScroll, { passive: true });
}

function initStickyBar() {
    if (!els.stickyBar || !els.purchaseSection) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (!entry.isIntersecting && entry.boundingClientRect.top < 0) els.stickyBar.classList.add('visible');
            else els.stickyBar.classList.remove('visible');
        });
    }, { threshold: 0 });
    observer.observe(els.purchaseSection);
}

function saveToHistory(product) {
    try {
        let history = JSON.parse(localStorage.getItem('pixeltech_view_history')) || [];
        history = history.filter(item => item.id !== product.id);
        history.unshift({ id: product.id, name: product.name, price: product.price, image: product.mainImage || product.image, category: product.category });
        if (history.length > 15) history.pop();
        localStorage.setItem('pixeltech_view_history', JSON.stringify(history));
    } catch (e) {}
}

async function updateShippingText() {
    if (!els.shippingText) return;
    try {
        const configSnap = await getDoc(doc(db, "config", "shipping"));
        let cutoffTime = "14:00"; 
        if (configSnap.exists()) cutoffTime = configSnap.data().cutoffTime || "14:00";
        const now = new Date();
        const [hours, minutes] = cutoffTime.split(':').map(Number);
        const cutoffDate = new Date();
        cutoffDate.setHours(hours, minutes, 0, 0);
        if (now < cutoffDate) els.shippingText.innerHTML = `<span class="text-green-600 font-black">¡Despacho HOY!</span> <span class="text-brand-black font-bold">si compras antes de las ${cutoffTime}</span>`;
        else els.shippingText.innerHTML = `<span class="text-brand-cyan font-black">Despacho MAÑANA</span> <span class="text-brand-black font-bold">(Compras después de las ${cutoffTime})</span>`;
    } catch (e) { els.shippingText.textContent = "Envío prioritario a nivel nacional."; }
}

function getStockForVariant(product, color, capacity) {
    if (product.isSimple) return product.stock || 0;
    if (!product.combinations) return 0;
    const variant = product.combinations.find(c => (c.color === color || (!c.color && !color)) && (c.capacity === capacity || (!c.capacity && !capacity)));
    return variant ? variant.stock : 0;
}

function updatePriceDisplay() {
    const p = state.product;
    let price = p.price;
    let stock = p.stock;
    let activeSku = p.sku || 'N/A'; 

    if (!p.isSimple && p.combinations) {
        if (state.selectedColor || state.selectedCapacity) {
            const variant = p.combinations.find(c => 
                (c.color === state.selectedColor || (!c.color && !state.selectedColor)) &&
                (c.capacity === state.selectedCapacity || (!c.capacity && !state.selectedCapacity))
            );
            if (variant) {
                stock = variant.stock;
                price = variant.price;
                if(variant.sku) activeSku = variant.sku; 
            } else {
                stock = 0; 
            }
        }
    }

    state.currentPrice = price;
    state.currentStock = stock;

    const currentQty = parseInt(els.qty.value) || 1;
    if (currentQty > stock) els.qty.value = Math.max(1, stock);
    if (stock <= 0) els.qty.value = 0;

    els.price.textContent = `$${price.toLocaleString('es-CO')}`;
    if(els.stickyPrice) els.stickyPrice.textContent = `$${price.toLocaleString('es-CO')}`;
    
    if(els.sku) {
        els.sku.textContent = `REF: ${activeSku}`;
        if (activeSku === 'N/A' || activeSku === '') els.sku.classList.add('hidden');
        else els.sku.classList.remove('hidden');
    }

    if (p.originalPrice && p.originalPrice > price) {
        const disc = Math.round(((p.originalPrice - price) / p.originalPrice) * 100);
        const formattedOld = `$${p.originalPrice.toLocaleString('es-CO')}`;
        els.price.classList.add('text-brand-red');
        els.oldPrice.textContent = formattedOld;
        els.oldPrice.classList.remove('hidden');
        if(els.discountTag) { els.discountTag.textContent = `-${disc}%`; els.discountTag.classList.remove('hidden'); }
        if(els.stickyDiscountRow) {
            els.stickyDiscountRow.classList.remove('hidden');
            els.stickyOldPrice.textContent = formattedOld;
            els.stickyBadge.textContent = `-${disc}%`;
            els.stickyPrice.classList.add('text-brand-red');
            els.stickyPrice.classList.remove('text-brand-black');
        }
    } else {
        els.price.classList.remove('text-brand-red');
        els.oldPrice.classList.add('hidden');
        if(els.discountTag) els.discountTag.classList.add('hidden');
        if(els.stickyDiscountRow) {
            els.stickyDiscountRow.classList.add('hidden');
            els.stickyPrice.classList.add('text-brand-black');
            els.stickyPrice.classList.remove('text-brand-red');
        }
    }

    if (els.stockText) {
        if (stock > 0) {
            els.stockText.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${stock} unidades disponibles`;
            els.stockText.className = "text-green-600 text-[10px] font-black uppercase tracking-widest mt-4 flex items-center gap-2";
            els.btnAdd.disabled = false;
            els.btnAdd.classList.remove('bg-gray-400', 'cursor-not-allowed');
            els.btnAdd.classList.add('bg-brand-cyan');
            els.btnAdd.textContent = "Agregar al carrito";
        } else {
            els.stockText.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Agotado`;
            els.stockText.className = "text-red-500 text-[10px] font-black uppercase tracking-widest mt-4 flex items-center gap-2";
            els.btnAdd.disabled = true;
            els.btnAdd.classList.add('bg-gray-400', 'cursor-not-allowed');
            els.btnAdd.classList.remove('bg-brand-cyan');
            els.btnAdd.textContent = "Sin Stock";
        }
    }
    renderAddiWidget(price); // <-- AGREGA ESTA LÍNEA AQUÍ
    injectProductSchema(p);
}

function updateGallery() {
    els.thumbsContainer.innerHTML = "";
    let displayImages = [];
    
    if (state.selectedColor && state.product.variants) {
        const v = state.product.variants.find(vari => vari.color === state.selectedColor);
        if (v && v.images) displayImages = [...v.images];
    }
    const globalImages = state.product.images || [];
    
    currentGalleryImages = Array.from(new Set([...displayImages, ...globalImages]));
    
    if (currentGalleryImages.length === 0) {
        currentGalleryImages = [state.product.mainImage || 'https://placehold.co/500'];
    }

    currentGalleryImages.forEach((src) => {
        const img = document.createElement('img');
        
        img.src = getResizedImageUrl(src); 
        
        img.onerror = function() {
            if (this.src !== src) {
                this.src = src;
            }
        };
        
        const activateImage = () => {
            if (state.currentImage === src) return; 
            state.currentImage = src;
            els.mainImg.src = src; 
            
            els.mainImg.classList.remove('fade-in');
            void els.mainImg.offsetWidth; 
            els.mainImg.classList.add('fade-in');

            Array.from(els.thumbsContainer.children).forEach(child => { 
                child.classList.remove('thumb-active'); 
                child.classList.add('thumb-inactive'); 
            });
            img.classList.remove('thumb-inactive'); 
            img.classList.add('thumb-active');
            
            img.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        };

        const isActive = state.currentImage === src;
        
        img.className = `min-w-[80px] w-20 md:w-full h-20 object-contain bg-white border rounded-xl cursor-pointer transition-all duration-200 shrink-0 snap-center ${isActive ? 'thumb-active' : 'thumb-inactive'}`;
        
        img.width = 80;
        img.height = 80;
        
        img.onmouseenter = activateImage; 
        img.onclick = activateImage;      
        
        els.thumbsContainer.appendChild(img);
    });
    
    initSwipeGallery();
}

function initSwipeGallery() {
    if (swipeInitialized || currentGalleryImages.length <= 1) return;
    
    const imgContainer = els.mainImg.parentElement; 
    
    let touchStartX = 0;
    let touchEndX = 0;

    imgContainer.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    imgContainer.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, { passive: true });

    function handleSwipe() {
        const swipeDistance = touchStartX - touchEndX;
        const minSwipeDistance = 40; 
        
        const currentIndex = currentGalleryImages.indexOf(state.currentImage);
        if (currentIndex === -1) return;

        if (swipeDistance > minSwipeDistance) {
            const nextIndex = (currentIndex + 1) % currentGalleryImages.length;
            changeToImageIndex(nextIndex);
        } 
        else if (swipeDistance < -minSwipeDistance) {
            const prevIndex = (currentIndex - 1 + currentGalleryImages.length) % currentGalleryImages.length;
            changeToImageIndex(prevIndex);
        }
    }
    
    swipeInitialized = true;
}

function changeToImageIndex(index) {
    const thumbs = els.thumbsContainer.children;
    if (thumbs && thumbs[index]) {
        thumbs[index].click(); 
    }
}


function renderOptions(p) {
    els.optionsContainer.innerHTML = "";
    
    let hasOptions = false; 

    // Colores
    if (p.hasVariants && p.variants?.length > 0) {
        hasOptions = true; 
        const colorDiv = document.createElement('div');
        colorDiv.innerHTML = `<label class="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 text-center md:text-left">Color</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3 justify-center md:justify-start";
        
        p.variants.forEach((v) => {
            const isSelected = state.selectedColor === v.color;
            let isOut = p.hasCapacities ? !p.combinations.some(c => c.color === v.color && c.stock > 0) : getStockForVariant(p, v.color, null) <= 0;
            const btn = document.createElement('button');
            let classes = "px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 relative ";
            if (isOut) { classes += "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60 "; btn.disabled = true; }
            else if (isSelected) classes += "bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20 ";
            else classes += "bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black ";
            btn.className = classes;
            btn.innerHTML = v.color + (isOut ? `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] px-1.5 rounded-full">AGOTADO</span>` : '');
            if (!isOut) btn.onclick = () => {
                state.selectedColor = v.color;
                if (p.hasCapacities) {
                    if (getStockForVariant(p, state.selectedColor, state.selectedCapacity) <= 0) {
                        const validCap = p.capacities.find(cap => getStockForVariant(p, state.selectedColor, cap.label) > 0);
                        if (validCap) state.selectedCapacity = validCap.label;
                    }
                }
                if (v.images?.length > 0) { state.currentImage = v.images[0]; els.mainImg.src = state.currentImage; }
                updateGallery(); updatePriceDisplay(); renderOptions(p);
            };
            btnContainer.appendChild(btn);
        });
        colorDiv.appendChild(btnContainer); els.optionsContainer.appendChild(colorDiv);
    }

    // Capacidades
    if (p.hasCapacities && p.capacities?.length > 0) {
        hasOptions = true; 
        const capDiv = document.createElement('div');
        capDiv.innerHTML = `<label class="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-2 text-center md:text-left">Capacidad</label>`;
        const btnContainer = document.createElement('div');
        btnContainer.className = "flex flex-wrap gap-3 justify-center md:justify-start";
        
        p.capacities.forEach((c) => {
            const isSelected = state.selectedCapacity === c.label;
            const isOut = state.selectedColor ? getStockForVariant(p, state.selectedColor, c.label) <= 0 : false; 
            const btn = document.createElement('button');
            let classes = `px-6 py-3 rounded-xl border-2 text-xs font-bold uppercase transition-all duration-200 flex flex-col items-center min-w-[100px] relative `;
            if (isOut) { classes += "bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60 "; btn.disabled = true; }
            else if (isSelected) classes += "bg-brand-cyan text-brand-black border-brand-cyan shadow-lg shadow-cyan-500/20 ";
            else classes += "bg-white text-gray-500 border-gray-100 hover:border-brand-cyan hover:text-brand-black ";
            btn.className = classes;
            
            let comboPrice = c.price; 
            if (p.combinations && state.selectedColor) {
                 const combo = p.combinations.find(comb => comb.color === state.selectedColor && comb.capacity === c.label);
                 if (combo) comboPrice = combo.price;
            } else if (p.combinations) {
                const combos = p.combinations.filter(comb => comb.capacity === c.label);
                if(combos.length > 0) comboPrice = Math.min(...combos.map(x => x.price));
            }

            btn.innerHTML = `<span>${c.label}</span><span class="text-[9px] font-normal mt-1 ${isSelected ? 'text-brand-black' : 'text-gray-400'}">$${comboPrice.toLocaleString('es-CO')}</span>${isOut ? `<span class="absolute -top-2 -right-2 bg-red-500 text-white text-[8px] px-1.5 rounded-full">AGOTADO</span>` : ''}`;
            if (!isOut) btn.onclick = () => { state.selectedCapacity = c.label; updatePriceDisplay(); renderOptions(p); };
            btnContainer.appendChild(btn);
        });
        capDiv.appendChild(btnContainer); els.optionsContainer.appendChild(capDiv);
    }

    if (hasOptions) {
        els.optionsContainer.classList.remove('hidden');
    } else {
        els.optionsContainer.classList.add('hidden');
    }
}

function handleAddToCart() {
    const qty = parseInt(els.qty.value) || 1;
    const p = state.product;
    if (qty > state.currentStock) { alert(`Solo hay ${state.currentStock} unidades disponibles.`); return; }
    if (p.hasCapacities && !state.selectedCapacity) { alert("Selecciona una capacidad"); return; }
    if (p.hasVariants && !state.selectedColor) { alert("Selecciona un color"); return; }

    const originalText = els.btnAdd.innerText;
    els.btnAdd.innerText = "¡Agregado!";
    els.btnAdd.classList.add('bg-green-500', 'text-white');

    trackEcommerceEvent('add_to_cart', {
        currency: "COP",
        value: state.currentPrice * qty,
        items: [{
            item_id: state.product.id,
            item_name: state.product.name,
            price: state.currentPrice,
            quantity: qty
        }]
    });
    
    addToCart({ id: p.id, name: p.name, price: state.currentPrice, image: state.currentImage, color: state.selectedColor, capacity: state.selectedCapacity, quantity: qty });
    if(window.showToast) window.showToast(`${p.name} agregado al carrito`);
    setTimeout(() => { els.btnAdd.innerText = originalText; els.btnAdd.classList.remove('bg-green-500', 'text-white'); }, 1000);
}

window.changeQty = (d) => {
    const i = document.getElementById('p-qty');
    let v = parseInt(i.value) + d;
    if(v < 1) v = 1;
    if(v > state.currentStock) v = state.currentStock;
    i.value = v;
};

// 🔥 FUNCIÓN ACTUALIZADA Y ESTRICTA PARA GOOGLE MERCHANT 🔥
function injectProductSchema(p) {
    const oldSchema = document.getElementById('json-ld-product');
    if (oldSchema) oldSchema.remove();
    
    const currentUrl = window.location.href; 
    
    const exactDisplayedPrice = state.currentPrice || p.price;
    const exactDisplayedStock = state.currentStock || p.stock || 0;
    const availability = exactDisplayedStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock";

    let schemaProductName = p.name;
    
    // 🔥 REPLICAMOS EXACTAMENTE LA LÓGICA DE IDs DEL XML DE MERCHANT 🔥
    let currentVariantId = p.id;
    let currentSku = p.sku || p.id;

    if (state.selectedColor || state.selectedCapacity) {
        schemaProductName = `${p.name} ${state.selectedCapacity || ''} ${state.selectedColor ? '- ' + state.selectedColor : ''}`.trim();
        
        if (p.combinations) {
            const combo = p.combinations.find(c => 
                (c.color === state.selectedColor || (!c.color && !state.selectedColor)) &&
                (c.capacity === state.selectedCapacity || (!c.capacity && !state.selectedCapacity))
            );
            if (combo) {
                // Genera un ID idéntico al que envía el feed XML
                currentVariantId = combo.sku || `${p.id}_${combo.color || 'x'}_${combo.capacity || 'y'}`.replace(/\s+/g, '');
                currentSku = combo.sku || p.sku || currentVariantId;
            }
        }
    }

    const schemaData = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": schemaProductName,
        "image": [state.currentImage || p.mainImage || p.image].filter(Boolean),
        "description": p.description ? p.description.replace(/<[^>]*>?/gm, '') : `Compra ${p.name} en PixelTech.`,
        "sku": currentSku,
        "productID": currentVariantId, // 👈 ESTO EVITA EL ERROR DE DISCREPANCIA
        "brand": { "@type": "Brand", "name": p.brand || "Genérico" },
        "offers": {
            "@type": "Offer",
            "url": currentUrl,
            "priceCurrency": "COP",
            "price": exactDisplayedPrice,
            "availability": availability,
            "itemCondition": "https://schema.org/NewCondition",
            "inventoryLevel": {
                "@type": "QuantitativeValue",
                "value": exactDisplayedStock
            }
        }
    };

    if (p.originalPrice && p.originalPrice > exactDisplayedPrice) {
         schemaData.offers.priceValidUntil = p.promoEndsAt ? new Date(p.promoEndsAt.seconds * 1000).toISOString() : new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString();
    }

    if (p.sku) {
        const cleanSku = p.sku.replace(/\s|-/g, '');
        if (/^\d{8}$|^\d{12,14}$/.test(cleanSku)) {
            schemaData.gtin = cleanSku; 
        } else {
            schemaData.mpn = p.sku; 
        }
    }

    const script = document.createElement('script');
    script.id = "json-ld-product";
    script.type = "application/ld+json";
    script.text = JSON.stringify(schemaData);
    document.head.appendChild(script);
}

function updateMetaTags(p) {
    document.title = `${p.name} | Compra en PixelTech`;
    const setMeta = (name, content, attribute = 'name') => {
        let element = document.querySelector(`meta[${attribute}="${name}"]`);
        if (!element) { element = document.createElement('meta'); element.setAttribute(attribute, name); document.head.appendChild(element); }
        element.setAttribute('content', content);
    };
    const currentUrl = window.location.href;
    const image = p.mainImage || p.image;
    const description = (p.description || '').replace(/<[^>]*>?/gm, '').substring(0, 150);
    setMeta('og:site_name', 'PixelTech Col', 'property');
    setMeta('description', `Compra ${p.name} al mejor precio. ${description}`);
    setMeta('og:type', 'product', 'property');
    setMeta('og:title', p.name, 'property');
    setMeta('og:description', description, 'property');
    setMeta('og:image', image, 'property');
    setMeta('og:url', currentUrl, 'property');
    setMeta('product:price:amount', p.price, 'property');
    setMeta('product:price:currency', 'COP', 'property');
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', p.name);
    setMeta('twitter:image', image);
    const canonicalLink = document.querySelector("link[rel='canonical']") || document.createElement("link");
    canonicalLink.setAttribute("rel", "canonical");
    canonicalLink.setAttribute("href", `${window.location.origin}/shop/product.html?id=${p.id}`);
    document.head.appendChild(canonicalLink);
}

function renderAddiWidget(price) {
    if (!els.addiContainer || price <= 0) return;

    // Si ya existe el widget, solo le actualizamos el precio (para cuando eligen otra variante)
    let existingWidget = els.addiContainer.querySelector('addi-widget');
    if (existingWidget) {
        existingWidget.setAttribute('price', price);
        return;
    }

    // Función para inyectar Addi de forma asíncrona
    const initAddi = () => {
        if (!document.getElementById('addi-script')) {
            const script = document.createElement('script');
            script.id = 'addi-script';
            script.src = "https://s3.amazonaws.com/widgets.addi.com/bundle.min.js";
            script.async = true; // Esto evita que bloquee a PageSpeed
            document.body.appendChild(script);
        }

        const widget = document.createElement('addi-widget');
        widget.setAttribute('price', price);
        widget.setAttribute('ally-slug', 'pixeltechcolombia-ecommerce');
        widget.setAttribute('text-color', '#111827');
        widget.setAttribute('logo-color', '#00AEC7');
        
        // Quitamos el esqueleto gris de carga
        const skeleton = document.getElementById('addi-skeleton');
        if (skeleton) skeleton.remove();
        
        els.addiContainer.appendChild(widget);
    };

    // Le pedimos al navegador que cargue Addi solo cuando no esté ocupado
    if ('requestIdleCallback' in window) {
        requestIdleCallback(initAddi);
    } else {
        setTimeout(initAddi, 1000);
    }
}