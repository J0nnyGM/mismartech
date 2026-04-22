import { db, storage, collection, getDocs, updateDoc, doc, query, orderBy, ref, uploadBytes, getDownloadURL, where } from "./firebase-init.js";
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

// DOM
const tableBody = document.getElementById('admin-products-list');
const searchInput = document.getElementById('promo-search');
const searchSpinner = document.getElementById('search-spinner'); 
const statusBar = document.getElementById('table-status-bar');
const modal = document.getElementById('promo-config-modal');
const form = document.getElementById('promo-form');
const fileContainer = document.getElementById('custom-file-container');
const radioButtons = document.getElementsByName('bannerType');

// Variables locales
let currentConfig = { id: null, field: null };
let allProducts = []; // Catálogo completo en memoria
let activePromos = []; // Solo las promos actuales

// --- HELPER COMPRESIÓN (Optimizado para Banners Grandes) ---
const compressImage = async (file) => {
    if (!file.type.startsWith('image/')) return file;
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
            img.onload = () => {
                const maxWidth = 1920; // Full HD para banners
                const quality = 0.85;
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => {
                    if (!blob) { reject(new Error('Error compress')); return; }
                    const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
                    resolve(new File([blob], newName, { type: 'image/webp', lastModified: Date.now() }));
                }, 'image/webp', quality);
            };
            img.onerror = (e) => reject(e);
        };
        reader.readAsDataURL(file);
    });
};

// --- 1. CARGA INICIAL (TODO EL CATÁLOGO ACTIVO) ---
async function loadCatalog() {
    tableBody.innerHTML = `<tr><td colspan="3" class="p-20 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-cyan"></i><p class="text-xs text-gray-400 mt-2 font-bold uppercase">Cargando productos...</p></td></tr>`;
    
    try {
        // Traemos todos los productos activos de una vez
        const q = query(collection(db, "products"), where("status", "==", "active"));
        const snap = await getDocs(q);
        
        allProducts = [];
        snap.forEach(doc => {
            allProducts.push({ id: doc.id, ...doc.data() });
        });

        // Ordenar alfabéticamente para facilitar la búsqueda visual
        allProducts.sort((a, b) => a.name.localeCompare(b.name));

        renderActivePromos(); // Mostrar por defecto las promos activas
        
        // Habilitar buscador visualmente
        searchInput.disabled = false;
        searchInput.placeholder = "Buscar producto para activar...";
        if(searchSpinner) searchSpinner.classList.add('hidden');

    } catch (e) {
        console.error(e);
        tableBody.innerHTML = `<tr><td colspan="3" class="p-10 text-center text-red-400 font-bold">Error cargando catálogo. Revisa la consola.</td></tr>`;
    }
}

// --- 2. RENDERIZADO POR DEFECTO (SOLO PROMOS) ---
function renderActivePromos() {
    // Filtramos en memoria los que ya son promo
    activePromos = allProducts.filter(p => p.isHeroPromo || p.isNewLaunch);
    
    if(statusBar) statusBar.classList.add('hidden');
    renderProducts(activePromos, "No hay promociones activas. ¡Usa el buscador para agregar una!");
}

// --- 3. BUSCADOR INSTANTÁNEO (MEMORIA) ---
searchInput.addEventListener('input', (e) => {
    const term = e.target.value.trim().toLowerCase();
    
    if (term.length === 0) {
        window.clearSearch();
        return;
    }

    // Filtro local instantáneo
    const results = allProducts.filter(p => {
        const text = `${p.name} ${p.brand || ''} ${p.category || ''}`.toLowerCase();
        return text.includes(term);
    });

    if(statusBar) {
        statusBar.classList.remove('hidden');
        document.getElementById('table-status-text').textContent = `Resultados para "${e.target.value}" (${results.length})`;
    }
    
    // Limitamos a 50 resultados para mantener el DOM ligero
    renderProducts(results.slice(0, 50), "No se encontraron productos con ese nombre."); 
});

window.clearSearch = () => {
    searchInput.value = "";
    if(statusBar) statusBar.classList.add('hidden');
    renderActivePromos();
};

// --- 4. RENDERIZADO TABLA ---
function renderProducts(products, emptyMsg) {
    tableBody.innerHTML = "";
    if (products.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="3" class="p-10 text-center text-gray-400 text-xs font-bold uppercase">${emptyMsg}</td></tr>`;
        return;
    }
    
    products.forEach(p => {
        let imageSrc = p.mainImage || p.image || (p.images && p.images[0]) || 'https://placehold.co/50';
        const isHeroPromo = p.isHeroPromo || false;
        const isNewLaunch = p.isNewLaunch || false;
        
        // Iconos para indicar si tiene banner personalizado
        const customIconHero = p.promoBannerUrl ? `<i class="fa-solid fa-image text-[8px] ml-1 text-brand-cyan" title="Banner Personalizado"></i>` : '';
        const customIconLaunch = p.launchBannerUrl ? `<i class="fa-solid fa-image text-[8px] ml-1 text-brand-cyan" title="Banner Personalizado"></i>` : '';

        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-50 hover:bg-gray-50/50 transition fade-in";
        tr.innerHTML = `
            <td class="p-6">
                <div class="flex items-center gap-4">
                    <img src="${imageSrc}" loading="lazy" class="w-12 h-12 rounded-xl object-contain bg-gray-100 p-1 border border-gray-200">
                    <div>
                        <p class="font-bold text-sm text-brand-black uppercase tracking-tighter line-clamp-1">${p.name}</p>
                        <div class="flex gap-2 mt-1">
                            <span class="text-[9px] font-black text-brand-cyan uppercase bg-cyan-50 px-2 py-0.5 rounded">${p.brand || 'Genérico'}</span>
                            <span class="text-[9px] font-bold text-gray-400 uppercase border border-gray-100 px-2 py-0.5 rounded">${p.category || 'Varios'}</span>
                        </div>
                    </div>
                </div>
            </td>
            <td class="p-6 text-center">
                <button onclick="updateFlag('${p.id}', 'isHeroPromo', ${!isHeroPromo})" class="w-10 h-10 rounded-full transition flex items-center justify-center mx-auto ${isHeroPromo ? 'bg-brand-red text-white shadow-lg' : 'bg-gray-100 text-gray-300 hover:text-gray-500'}">
                    <i class="fa-solid fa-fire text-sm"></i> ${customIconHero}
                </button>
            </td>
            <td class="p-6 text-center">
                <button onclick="updateFlag('${p.id}', 'isNewLaunch', ${!isNewLaunch})" class="w-10 h-10 rounded-full transition flex items-center justify-center mx-auto ${isNewLaunch ? 'bg-brand-cyan text-brand-black shadow-lg' : 'bg-gray-100 text-gray-300 hover:text-gray-500'}">
                    <i class="fa-solid fa-star text-sm"></i> ${customIconLaunch}
                </button>
            </td>`;
        tableBody.appendChild(tr);
    });
}

// --- 5. LÓGICA DE ACTUALIZACIÓN ---
window.updateFlag = async (id, field, value) => {
    if (value === true) {
        // Abrir modal para configurar (Auto o Custom)
        openConfigModal(id, field);
    } else {
        // Desactivar promo directamente
        try {
            const productRef = doc(db, "products", id);
            const urlField = field === 'isHeroPromo' ? 'promoBannerUrl' : 'launchBannerUrl';
            
            // 1. Actualizar Firebase
            await updateDoc(productRef, { [field]: false, [urlField]: null });
            
            // 2. Actualizar Memoria Local (Instantáneo)
            const pIndex = allProducts.findIndex(x => x.id === id);
            if (pIndex !== -1) {
                allProducts[pIndex][field] = false;
                allProducts[pIndex][urlField] = null;
            }
            
            // 3. Refrescar Vista
            if (searchInput.value.trim() === "") renderActivePromos();
            else searchInput.dispatchEvent(new Event('input'));
            
        } catch (e) { alert("Error: " + e.message); }
    }
};

function openConfigModal(id, field) {
    currentConfig = { id, field };
    form.reset();
    fileContainer.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

window.closeConfigModal = () => {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    currentConfig = { id: null, field: null };
};

radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'custom') fileContainer.classList.remove('hidden');
        else fileContainer.classList.add('hidden');
    });
});

// Guardar configuración desde el modal
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const originalText = btn.textContent;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

    try {
        const bannerType = document.querySelector('input[name="bannerType"]:checked').value;
        let bannerUrl = null;

        if (bannerType === 'custom') {
            const fileInput = document.getElementById('banner-file');
            if (fileInput.files.length > 0) {
                const file = fileInput.files[0];
                
                // Compresión
                btn.innerHTML = '<i class="fa-solid fa-compress fa-spin"></i> Optimizando...';
                const compressedFile = await compressImage(file);
                
                // 🔥 NUEVO: Forzamos caché público por 1 año en los celulares de los clientes
                const metadata = {
                    cacheControl: 'public,max-age=31536000'
                };

                // Subida
                btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up fa-spin"></i> Subiendo...';
                const storageRef = ref(storage, `banners/${currentConfig.field}/${currentConfig.id}_${Date.now()}_${compressedFile.name}`);
                
                // Le pasamos la metadata a Firebase
                await uploadBytes(storageRef, compressedFile, metadata);
                bannerUrl = await getDownloadURL(storageRef);
            } else {
                alert("⚠️ Selecciona una imagen.");
                btn.disabled = false; btn.textContent = originalText;
                return;
            }
        }

        const urlField = currentConfig.field === 'isHeroPromo' ? 'promoBannerUrl' : 'launchBannerUrl';
        const productRef = doc(db, "products", currentConfig.id);
        
        // Actualizar Firebase
        await updateDoc(productRef, { [currentConfig.field]: true, [urlField]: bannerUrl || null });
        
        // Actualizar Memoria Local
        const pIndex = allProducts.findIndex(x => x.id === currentConfig.id);
        if (pIndex !== -1) {
            allProducts[pIndex][currentConfig.field] = true;
            allProducts[pIndex][urlField] = bannerUrl || null;
        }

        closeConfigModal();
        
        if (searchInput.value.trim() === "") renderActivePromos();
        else searchInput.dispatchEvent(new Event('input'));

    } catch (e) {
        console.error(e);
        alert("Error al guardar: " + e.message);
    } finally {
        btn.disabled = false; btn.textContent = originalText;
    }
});

// Start
loadCatalog();