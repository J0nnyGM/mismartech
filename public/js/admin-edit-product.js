import { auth, db, storage, doc, getDoc, updateDoc, collection, getDocs, addDoc, query, orderBy, limit, ref, uploadBytes, getDownloadURL, writeBatch } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const params = new URLSearchParams(window.location.search);
const productId = params.get('id');
const form = document.getElementById('main-form');
const btnUpdate = document.getElementById('btn-update');
const descriptionEditor = document.getElementById('p-description-editor');
const stockInput = document.getElementById('p-stock');
const priceInput = document.getElementById('p-price');
const stockLabel = document.getElementById('stock-label-type');

// Tipos de imagen permitidos
const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// --- FORMATO DE MONEDA Y HELPER SKU ---
const getRawPrice = () => {
    const raw = priceInput.value.replace(/\D/g, ''); 
    return raw ? parseInt(raw) : 0;
};

priceInput.addEventListener('input', (e) => {
    const val = e.target.value.replace(/\D/g, '');
    if (val) {
        e.target.value = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val);
    } else {
        e.target.value = '';
    }
});

function lockGlobalInputs() { 
    stockInput.readOnly = true;
    stockInput.classList.add('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
    stockLabel.innerHTML = "Stock Total <span class='text-xs text-brand-cyan'>(Auto)</span>";

    const skuInput = document.getElementById('p-sku');
    if(skuInput) {
        skuInput.readOnly = true;
        skuInput.classList.add('text-gray-300', 'cursor-not-allowed');
        skuInput.title = "Para productos con variantes, define el SKU en la tabla de abajo.";
    }
}

function unlockGlobalInputs() { 
    stockInput.readOnly = false;
    stockInput.classList.remove('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
    stockLabel.innerHTML = "Stock Total <span class='text-xs text-brand-cyan'>(Editable)</span>";

    const skuInput = document.getElementById('p-sku');
    if(skuInput) {
        skuInput.readOnly = false;
        skuInput.classList.remove('text-gray-300', 'cursor-not-allowed');
        skuInput.title = "";
    }
}

// --- ESTADO ---
let globalFiles = []; 
let definedColors = [];
let definedCaps = [];
let colorImagesMap = {};
let matrixData = {};
let cachedCategories = []; 

// --- COMPRESIÓN ---
const compressImage = async (file) => {
    if (!file.type.startsWith('image/')) return file;
    return new Promise((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = (e) => {
            img.src = e.target.result;
            img.onload = () => {
                const maxWidth = 1600; 
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

// --- 1. CARGA INICIAL ---
async function initEdit() {
    if (!productId) { window.location.href = 'products.html'; return; }

    try {
        const docSnap = await getDoc(doc(db, "products", productId));
        if (!docSnap.exists()) { window.location.href = 'products.html'; return; }

        const p = docSnap.data();

        // 1. Datos Básicos
        const initialPrice = p.price || 0;
        document.getElementById('p-name').value = p.name || '';
        document.getElementById('p-sku').value = p.sku || '';
        document.getElementById('p-brand').value = p.brand || '';
        document.getElementById('p-price').value = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(initialPrice);
        document.getElementById('p-stock').value = p.stock || 0; 
        document.getElementById('p-status').value = p.status || 'active';
        
        // 2. Categoría
        document.getElementById('p-category').value = p.category || '';
        let subInput = document.getElementById('p-subcategory');
        if(!subInput) {
            subInput = document.createElement('input');
            subInput.type = 'hidden';
            subInput.id = 'p-subcategory';
            document.querySelector('.admin-input-group.relative').appendChild(subInput);
        }
        subInput.value = p.subcategory || '';
        document.getElementById('cat-search').value = p.subcategory ? `${p.subcategory} (${p.category})` : p.category;

        // 3. Garantía
        if(p.warranty) {
            document.getElementById('p-warranty-time').value = p.warranty.time || '';
            document.getElementById('p-warranty-unit').value = p.warranty.unit || 'months';
        }

        document.getElementById('product-id-display').textContent = `ID: ${productId}`;
        descriptionEditor.innerHTML = p.description || '';

        // 4. Imágenes Globales
        globalFiles = [];
        if (p.images && Array.isArray(p.images) && p.images.length > 0) {
            globalFiles = p.images.map(url => ({ id: Math.random().toString(36).substr(2,9), type: 'url', content: url }));
        } else if (p.mainImage) {
            globalFiles.push({ id: Math.random().toString(36).substr(2,9), type: 'url', content: p.mainImage });
        }
        renderGlobalGallery();

        // 5. Variantes y Atributos (ESTRUCTURA SINCRONIZADA)
        definedColors = [];
        definedCaps = [];
        colorImagesMap = {};
        matrixData = {};

        if (p.definedColors && Array.isArray(p.definedColors)) definedColors = p.definedColors;
        if (p.definedCapacities && Array.isArray(p.definedCapacities)) definedCaps = p.definedCapacities;

        if (definedColors.length === 0 && p.variants && Array.isArray(p.variants)) {
            p.variants.forEach(v => {
                if (v.color && !definedColors.includes(v.color)) definedColors.push(v.color);
            });
        }
        if (definedCaps.length === 0 && p.capacities && Array.isArray(p.capacities)) {
            p.capacities.forEach(c => {
                const label = typeof c === 'object' ? c.label : c;
                if (label && !definedCaps.includes(label)) definedCaps.push(label);
            });
        }

        // B. Cargar Imágenes por Color
        if (p.colorImages) {
             Object.keys(p.colorImages).forEach(color => {
                 const urls = p.colorImages[color] || [];
                 colorImagesMap[color] = urls.map(url => ({
                     id: Math.random().toString(36).substr(2,9), type: 'url', content: url
                 }));
             });
        } else if (p.variants) {
             p.variants.forEach(v => {
                 if (v.color && v.images) {
                     colorImagesMap[v.color] = v.images.map(url => ({
                         id: Math.random().toString(36).substr(2,9), type: 'url', content: url
                     }));
                 }
             });
        }

        // C. Cargar Matriz (SKU y Stock por variante)
        if(p.combinations && Array.isArray(p.combinations)) {
            p.combinations.forEach(comb => {
                let key = '';
                if(comb.color && comb.capacity) key = `${comb.color}-${comb.capacity}`;
                else if(comb.color) key = comb.color;
                else if(comb.capacity) key = comb.capacity;
                
                if(key) {
                    matrixData[key] = { 
                        price: comb.price, 
                        stock: comb.stock, 
                        sku: comb.sku 
                    };
                }
            });
        }

        renderTags();
        renderColorUploaders();
        renderMatrix();
        loadProductHistory(); 

        document.getElementById('loader-view').classList.add('hidden');
        document.getElementById('edit-view').classList.remove('hidden');

    } catch (e) { 
        console.error("Error cargando producto:", e); 
        alert("Hubo un error cargando el producto. Revisa la consola.");
    }
}

// --- 2. GESTIÓN IMÁGENES ---
const pImagesInput = document.getElementById('p-images');
if (pImagesInput) {
    pImagesInput.onchange = (e) => {
        let hasInvalid = false;
        Array.from(e.target.files).forEach(file => {
            if (VALID_IMAGE_TYPES.includes(file.type)) {
                globalFiles.push({ id: Math.random().toString(36).substr(2,9), type: 'file', content: file });
            } else {
                hasInvalid = true;
            }
        });
        if (hasInvalid) alert("Algunos archivos fueron ignorados. Solo se permiten imágenes JPG, PNG o WEBP.");
        renderGlobalGallery();
        e.target.value = "";
    };
}

function renderGlobalGallery() {
    const container = document.getElementById('gallery-container');
    if(!container) return;
    container.innerHTML = "";
    if (globalFiles.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-4 text-gray-300 text-xs italic">Sin imágenes globales</div>`;
        return;
    }
    globalFiles.forEach((item, index) => {
        const src = item.type === 'url' ? item.content : URL.createObjectURL(item.content);
        const div = document.createElement('div');
        div.className = "relative aspect-square rounded-2xl overflow-hidden border shadow-sm group bg-white";
        div.innerHTML = `<img src="${src}" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-brand-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                <div class="flex gap-2">
                    <button type="button" onclick="moveGlobalImage(${index}, -1)" class="w-8 h-8 rounded-lg bg-white text-brand-black hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-left text-xs"></i></button>
                    <button type="button" onclick="moveGlobalImage(${index}, 1)" class="w-8 h-8 rounded-lg bg-white text-brand-black hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-right text-xs"></i></button>
                </div>
                <button type="button" onclick="removeGlobalImage('${item.id}')" class="text-[8px] font-black uppercase text-red-400 hover:text-red-200 transition">Eliminar</button>
            </div>
            <div class="absolute top-2 left-2 bg-brand-black/50 backdrop-blur-md text-white text-[7px] px-2 py-1 rounded-md font-bold uppercase pointer-events-none">
                 ${index === 0 ? 'PORTADA' : index + 1}
            </div>`;
        container.appendChild(div);
    });
}
window.moveGlobalImage = (index, direction) => {
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= globalFiles.length) return;
    const temp = globalFiles[index];
    globalFiles[index] = globalFiles[newIdx];
    globalFiles[newIdx] = temp;
    renderGlobalGallery();
};
window.removeGlobalImage = (id) => { globalFiles = globalFiles.filter(i => i.id !== id); renderGlobalGallery(); };

// --- 3. ATRIBUTOS ---
document.getElementById('btn-add-color').onclick = () => {
    const input = document.getElementById('new-color-input');
    const val = input.value.trim();
    if(val && !definedColors.includes(val)) { definedColors.push(val); colorImagesMap[val] = []; renderTags(); renderColorUploaders(); renderMatrix(); input.value = ""; }
};
document.getElementById('btn-add-cap').onclick = () => {
    const input = document.getElementById('new-cap-input');
    const val = input.value.trim();
    if(val && !definedCaps.includes(val)) { definedCaps.push(val); renderTags(); renderMatrix(); input.value = ""; }
};
function renderTags() {
    document.getElementById('tags-colors').innerHTML = definedColors.map(c => `<span class="bg-brand-black text-white px-3 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-2">${c} <button type="button" onclick="removeAttr('color', '${c}')" class="hover:text-red-400">×</button></span>`).join('');
    document.getElementById('tags-caps').innerHTML = definedCaps.map(c => `<span class="bg-slate-200 text-gray-600 px-3 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-2">${c} <button type="button" onclick="removeAttr('cap', '${c}')" class="hover:text-red-500">×</button></span>`).join('');
}
window.removeAttr = (type, val) => {
    if(type === 'color') { definedColors = definedColors.filter(c => c !== val); delete colorImagesMap[val]; renderColorUploaders(); } else { definedCaps = definedCaps.filter(c => c !== val); }
    renderTags(); renderMatrix(); 
};

// --- 4. FOTOS COLOR ---
function renderColorUploaders() {
    const container = document.getElementById('color-uploaders-container');
    const section = document.getElementById('color-images-section');
    if(definedColors.length === 0) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    container.innerHTML = "";
    
    definedColors.forEach(color => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-gray-100";
        
        let imagesHTML = (colorImagesMap[color] || []).map((item, idx) => {
            const src = item.type === 'url' ? item.content : URL.createObjectURL(item.content);
            return `
                <div class="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 bg-white relative group">
                    <img src="${src}" class="w-full h-full object-cover">
                    <button type="button" onclick="removeColorImage('${color}', ${idx})" 
                        class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 text-white transition">
                        <i class="fa-solid fa-xmark text-[10px]"></i>
                    </button>
                </div>`;
        }).join('');

        div.innerHTML = `
            <div class="w-24 shrink-0"><span class="text-xs font-bold text-brand-black">${color}</span></div>
            <div class="flex gap-2 flex-wrap flex-grow">${imagesHTML}</div>
            <label class="cursor-pointer bg-white border border-gray-200 text-brand-black px-3 py-2 rounded-lg text-[9px] font-black uppercase hover:bg-brand-cyan hover:border-brand-cyan transition">
                + Fotos <input type="file" multiple accept=".png, .jpg, .jpeg, .webp, image/png, image/jpeg, image/webp" class="hidden" onchange="addColorImages('${color}', this.files)">
            </label>`;
        container.appendChild(div);
    });
}

window.removeColorImage = (color, index) => {
    if (colorImagesMap[color]) {
        colorImagesMap[color].splice(index, 1);
        renderColorUploaders();
    }
};

window.addColorImages = (color, files) => { 
    if(!colorImagesMap[color]) colorImagesMap[color] = [];
    let hasInvalid = false;
    Array.from(files).forEach(file => {
        if (VALID_IMAGE_TYPES.includes(file.type)) {
            colorImagesMap[color].push({ id: Math.random().toString(36).substr(2,9), type: 'file', content: file });
        } else {
            hasInvalid = true;
        }
    });
    if (hasInvalid) alert("Formato inválido. Solo se admiten JPG, PNG y WEBP.");
    renderColorUploaders(); 
};

// --- 5. MATRIZ ---
function renderMatrix() {
    const tbody = document.getElementById('matrix-tbody');
    const globalSku = document.getElementById('p-sku').value.trim().toUpperCase();
    tbody.innerHTML = "";
    
    if(definedColors.length === 0 && definedCaps.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-300 text-xs">Producto Simple (Sin variantes)</td></tr>`;
        unlockGlobalInputs(); 
        recalcTotalStock();
        return;
    }

    lockGlobalInputs(); 

    let rows = [];
    if(definedColors.length > 0 && definedCaps.length > 0) definedColors.forEach(c => definedCaps.forEach(k => rows.push({ key: `${c}-${k}`, label: `${c} + ${k}`, color: c, cap: k })));
    else if(definedColors.length > 0) definedColors.forEach(c => rows.push({ key: c, label: c, color: c, cap: '' }));
    else if(definedCaps.length > 0) definedCaps.forEach(k => rows.push({ key: k, label: k, color: '', cap: k }));

    rows.forEach(row => {
        const defaultSku = `${globalSku}-${row.color ? row.color.substring(0,3) : ''}-${row.cap ? row.cap : ''}`.replace(/-+$/, '').toUpperCase();
        
        const prev = matrixData[row.key] || { 
            price: getRawPrice(), 
            stock: 0,
            sku: defaultSku 
        };
        matrixData[row.key] = prev;

        const tr = document.createElement('tr');
        tr.className = "border-b border-gray-50 hover:bg-slate-50 transition";
        tr.innerHTML = `
            <td class="p-4"><span class="font-black text-brand-black text-xs">${row.label}</span></td>
            <td class="p-4">
                <input type="text" value="${prev.sku || ''}" 
                onchange="updateMatrixData('${row.key}', 'sku', this.value)" 
                class="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-gray-500 outline-none focus:border-brand-cyan focus:text-brand-black uppercase">
            </td>
            <td class="p-4"><input type="number" value="${prev.price}" onchange="updateMatrixData('${row.key}', 'price', this.value)" class="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-brand-cyan outline-none focus:border-brand-cyan"></td>
            
            <td class="p-4">
                <input type="number" value="${prev.stock}" 
                onchange="updateMatrixData('${row.key}', 'stock', this.value)" 
                class="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-brand-black outline-none focus:border-brand-cyan">
            </td>`;
        tbody.appendChild(tr);
    });
    recalcTotalStock();
}

window.updateMatrixData = (key, field, val) => { 
    if(!matrixData[key]) matrixData[key]={}; 
    if (field === 'sku') {
        matrixData[key][field] = val.toUpperCase();
    } else {
        matrixData[key][field] = Number(val);
    }
    if (field === 'stock') recalcTotalStock();
};

function recalcTotalStock() {
    let total = 0;
    if (definedColors.length > 0 || definedCaps.length > 0) {
        const activeKeys = [];
        if(definedColors.length > 0 && definedCaps.length > 0) definedColors.forEach(c => definedCaps.forEach(k => activeKeys.push(`${c}-${k}`)));
        else if(definedColors.length > 0) definedColors.forEach(c => activeKeys.push(c));
        else if(definedCaps.length > 0) definedCaps.forEach(k => activeKeys.push(k));
        
        activeKeys.forEach(k => total += (matrixData[k]?.stock || 0));
        stockInput.value = total;
    }
}

// --- CATEGORÍAS ---
const catSearchInput = document.getElementById('cat-search');
const catResults = document.getElementById('cat-results');
const pCategoryHidden = document.getElementById('p-category');
let pSubCategoryHidden = document.getElementById('p-subcategory');

if(!pSubCategoryHidden) {
    pSubCategoryHidden = document.createElement('input');
    pSubCategoryHidden.type = 'hidden';
    pSubCategoryHidden.id = 'p-subcategory';
    document.querySelector('.admin-input-group.relative').appendChild(pSubCategoryHidden);
}

async function loadCategoriesToMemory() {
    if (cachedCategories.length > 0) return;
    const CACHE_KEY = 'admin_categories_cache_v2';
    const stored = sessionStorage.getItem(CACHE_KEY);
    if (stored) { cachedCategories = JSON.parse(stored); return; }

    try {
        const q = query(collection(db, "categories"), orderBy("name"));
        const snap = await getDocs(q);
        cachedCategories = [];
        snap.forEach(d => {
            const data = d.data();
            const catName = data.name || "Sin Nombre";
            if (data.subcategories && Array.isArray(data.subcategories) && data.subcategories.length > 0) {
                data.subcategories.forEach(sub => {
                    let subName = sub;
                    if (typeof sub === 'object' && sub !== null) subName = sub.name || sub.label || "Subcategoría";
                    cachedCategories.push({ category: catName, subcategory: subName, searchStr: `${subName} ${catName}`.toLowerCase() });
                });
            } else {
                cachedCategories.push({ category: catName, subcategory: null, searchStr: catName.toLowerCase() });
            }
        });
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cachedCategories));
    } catch (e) { console.error("Error cats:", e); }
}

if (catSearchInput) {
    catSearchInput.addEventListener('focus', loadCategoriesToMemory);
    catSearchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (term.length < 1) { catResults.classList.add('hidden'); return; }
        const matches = cachedCategories.filter(item => item.searchStr.includes(term));
        catResults.innerHTML = '';
        if (matches.length === 0) catResults.innerHTML = `<div class="p-3 text-xs text-gray-400 text-center">No encontrado</div>`;
        else {
            matches.slice(0, 10).forEach(match => {
                const div = document.createElement('div');
                div.className = "p-4 hover:bg-brand-cyan/10 cursor-pointer text-xs font-bold rounded-xl flex justify-between items-center transition border-b border-gray-50 last:border-0";
                div.innerHTML = `<span class="text-brand-black">${match.subcategory || 'General'}</span><span class="text-[9px] text-gray-400 uppercase bg-gray-50 px-2 py-1 rounded-md border border-gray-100">${match.category}</span>`;
                div.onclick = () => { 
                    catSearchInput.value = match.subcategory ? `${match.subcategory} (${match.category})` : match.category;
                    pCategoryHidden.value = match.category; 
                    pSubCategoryHidden.value = match.subcategory || ''; 
                    catResults.classList.add('hidden'); 
                };
                catResults.appendChild(div);
            });
        }
        catResults.classList.remove('hidden');
    });
    document.addEventListener('click', (e) => {
        if (!catSearchInput.contains(e.target) && !catResults.contains(e.target)) catResults.classList.add('hidden');
    });
}

// --- GUARDAR ACTUALIZACIÓN ---
form.onsubmit = async (e) => {
    e.preventDefault();
    btnUpdate.disabled = true; 
    btnUpdate.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> ACTUALIZANDO...';

    try {
        const newGlobalFiles = globalFiles.filter(i => i.type === 'file');
        const oldGlobalUrls = globalFiles.filter(i => i.type === 'url').map(i => i.content);

        const optimizedGlobal = await Promise.all(newGlobalFiles.map(i => compressImage(i.content)));
        const uploadedGlobal = await Promise.all(optimizedGlobal.map(async (file) => {
            const refImg = ref(storage, `products/global/${Date.now()}_${file.name}`);
            await uploadBytes(refImg, file);
            return getDownloadURL(refImg);
        }));

        let uploadCursor = 0;
        const finalGlobalUrls = globalFiles.map(item => {
            if (item.type === 'url') return item.content;
            else return uploadedGlobal[uploadCursor++];
        });

        const colorUrlsMap = {};
        const colorUploadPromises = [];

        for (const color of definedColors) {
            const files = colorImagesMap[color] || [];
            const newColorFiles = files.filter(i => i.type === 'file');
            const oldColorUrls = files.filter(i => i.type === 'url').map(i => i.content);

            if (newColorFiles.length > 0) {
                const p = (async () => {
                    const optimized = await Promise.all(newColorFiles.map(i => compressImage(i.content)));
                    const uploaded = await Promise.all(optimized.map(async (file) => {
                        const refImg = ref(storage, `products/variants/${Date.now()}_${color}_${file.name}`);
                        await uploadBytes(refImg, file);
                        return getDownloadURL(refImg);
                    }));
                    let cCursor = 0;
                    colorUrlsMap[color] = files.map(item => {
                        if (item.type === 'url') return item.content;
                        else return uploaded[cCursor++];
                    });
                })();
                colorUploadPromises.push(p);
            } else {
                colorUrlsMap[color] = oldColorUrls;
            }
        }
        await Promise.all(colorUploadPromises);

        // PREPARAR DATOS 
        const variants = definedColors.map(color => ({ 
            color: color, 
            images: colorUrlsMap[color] || [] 
        }));

        const capacities = definedCaps.map(cap => ({ label: cap, price: 0 }));

        const combinations = [];
        let minPrice = Infinity;
        const activeKeys = [];
        
        if(definedColors.length > 0 && definedCaps.length > 0) definedColors.forEach(c => definedCaps.forEach(k => activeKeys.push(`${c}-${k}`)));
        else if(definedColors.length > 0) definedColors.forEach(c => activeKeys.push(c));
        else if(definedCaps.length > 0) definedCaps.forEach(k => activeKeys.push(k));

        activeKeys.forEach(key => {
            const data = matrixData[key];
            const parts = key.split('-');
            const color = definedColors.length > 0 ? (parts.length > 1 ? parts[0] : (definedColors.includes(key) ? key : null)) : null;
            const cap = definedCaps.length > 0 ? (parts.length > 1 ? parts[1] : (definedCaps.includes(key) ? key : null)) : null;
            
            if(cap) {
                const cIdx = capacities.findIndex(c => c.label === cap);
                if(cIdx >= 0 && data?.price) capacities[cIdx].price = data.price;
            }

            const rowSku = data?.sku || `${document.getElementById('p-sku').value}-${color?color.substring(0,3):''}-${cap?cap:''}`.toUpperCase();

            combinations.push({
                color: color, 
                capacity: cap, 
                price: data?.price || 0, 
                stock: data?.stock || 0,
                sku: rowSku 
            });
            if((data?.price || 0) < minPrice) minPrice = data?.price;
        });

        const isSimple = combinations.length === 0;
        const finalPrice = isSimple ? getRawPrice() : minPrice;
        const finalStock = isSimple ? Number(stockInput.value) : combinations.reduce((a, b) => a + b.stock, 0);

        const updateData = {
            name: document.getElementById('p-name').value,
            sku: document.getElementById('p-sku').value,
            brand: document.getElementById('p-brand').value,
            category: pCategoryHidden.value || document.getElementById('p-category').value,
            subcategory: document.getElementById('p-subcategory').value,
            status: document.getElementById('p-status').value, // 🔥 CORRECCIÓN: Seleccionado del desplegable
            description: descriptionEditor.innerHTML,
            updatedAt: new Date(),
            price: finalPrice,
            stock: finalStock,
            warranty: {
                time: Number(document.getElementById('p-warranty-time').value) || 0,
                unit: document.getElementById('p-warranty-unit').value
            },
            isSimple: isSimple,
            combinations: combinations,
            
            hasVariants: definedColors.length > 0,
            hasCapacities: definedCaps.length > 0,
            variants: variants, 
            capacities: capacities, 
            definedColors: definedColors, 
            definedCapacities: definedCaps, 
            images: finalGlobalUrls,
            colorImages: colorUrlsMap,
            mainImage: finalGlobalUrls[0] || (Object.values(colorUrlsMap)[0] ? Object.values(colorUrlsMap)[0][0] : '')
        };

        const batch = writeBatch(db);
        const productRef = doc(db, "products", productId);
        batch.update(productRef, updateData);

        const historyRef = doc(collection(db, "products", productId, "history"));
        batch.set(historyRef, {
            adminEmail: auth.currentUser.email,
            action: `Edición de Producto/Stock`,
            timestamp: new Date()
        });

        await batch.commit();
        alert("✅ Producto actualizado correctamente.");
        window.location.href = "products.html";

    } catch (err) { 
        console.error(err);
        alert("Error: " + err.message); 
        btnUpdate.disabled = false; 
        btnUpdate.innerHTML = "Actualizar Cambios";
    }
};

async function loadProductHistory() {
    const container = document.getElementById('history-container');
    const q = query(collection(db, "products", productId, "history"), orderBy("timestamp", "desc"), limit(5));
    const snap = await getDocs(q);
    if (!snap.empty) {
        container.innerHTML = "";
        snap.forEach(d => {
            const log = d.data();
            container.innerHTML += `
                <div class="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-gray-50">
                    <div class="flex-grow">
                        <p class="text-[10px] font-black uppercase">${log.adminEmail}</p>
                        <p class="text-[9px] text-gray-400 font-bold">${log.timestamp?.toDate().toLocaleString()} — ${log.action}</p>
                    </div>
                </div>`;
        });
    }
}

window.formatDoc = (cmd, value = null) => { document.execCommand(cmd, false, value); descriptionEditor.focus(); };

initEdit();