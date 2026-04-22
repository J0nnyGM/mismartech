import { db, storage, collection, addDoc, getDocs, ref, uploadBytes, getDownloadURL, query, orderBy } from './firebase-init.js'; 
import { loadAdminSidebar } from './admin-ui.js';

loadAdminSidebar();

const form = document.getElementById('main-form');
const btnPublish = document.getElementById('btn-publish');
const descriptionEditor = document.getElementById('p-description-editor');
const stockInput = document.getElementById('p-stock');
const priceInput = document.getElementById('p-price');
const stockLabel = document.getElementById('stock-label-type');

// --- LÓGICA DE FORMATO DE MONEDA ---
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

// --- ESTADO GLOBAL ---
let globalFiles = []; 
let definedColors = [];
let definedCaps = [];
let colorImagesMap = {};
let matrixData = {};
let cachedCategories = []; 

// Tipos de imagen permitidos
const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// --- 1. GALERÍA GLOBAL ---
const pImagesInput = document.getElementById('p-images');
if (pImagesInput) {
    pImagesInput.onchange = (e) => {
        let hasInvalid = false;
        Array.from(e.target.files).forEach(file => {
            if (VALID_IMAGE_TYPES.includes(file.type)) {
                globalFiles.push({ id: Math.random().toString(36).substr(2, 9), file });
            } else {
                hasInvalid = true;
                console.warn(`Archivo ignorado: ${file.name} (Solo JPG, PNG, WEBP)`);
            }
        });
        if (hasInvalid) alert("Algunos archivos fueron ignorados. Solo se permiten imágenes JPG, PNG o WEBP.");
        renderGlobalGallery();
        e.target.value = "";
    };
}

function renderGlobalGallery() {
    const container = document.getElementById('gallery-container');
    if (!container) return;
    container.innerHTML = "";
    
    globalFiles.forEach((item, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = "relative aspect-square rounded-2xl overflow-hidden border-2 border-gray-100 bg-white group shadow-sm";
            div.innerHTML = `
                <img src="${e.target.result}" class="w-full h-full object-cover">
                <div class="absolute inset-0 bg-brand-black/80 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                    <div class="flex gap-1">
                        <button type="button" onclick="moveGlobalImage(${index}, -1)" class="w-8 h-8 rounded-lg bg-white/20 text-white hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-left text-xs"></i></button>
                        <button type="button" onclick="moveGlobalImage(${index}, 1)" class="w-8 h-8 rounded-lg bg-white/20 text-white hover:bg-brand-cyan transition"><i class="fa-solid fa-arrow-right text-xs"></i></button>
                    </div>
                    <button type="button" onclick="removeGlobalImage('${item.id}')" class="text-[8px] font-black uppercase text-red-400 hover:text-red-200 transition mt-2">Eliminar</button>
                </div>
                <div class="absolute top-2 left-2 bg-brand-black/50 backdrop-blur-md text-white text-[7px] px-2 py-1 rounded-md font-bold uppercase">
                    ${index === 0 ? 'PORTADA' : 'POSICIÓN ' + (index + 1)}
                </div>
            `;
            container.appendChild(div);
        };
        reader.readAsDataURL(item.file);
    });
}

window.moveGlobalImage = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= globalFiles.length) return;
    const temp = globalFiles[index];
    globalFiles[index] = globalFiles[newIndex];
    globalFiles[newIndex] = temp;
    renderGlobalGallery();
};

window.removeGlobalImage = (id) => { globalFiles = globalFiles.filter(i => i.id !== id); renderGlobalGallery(); };

// --- 2. GESTIÓN DE ATRIBUTOS ---
document.getElementById('btn-add-color').onclick = () => {
    const input = document.getElementById('new-color-input');
    const val = input.value.trim();
    if(val && !definedColors.includes(val)) {
        definedColors.push(val);
        colorImagesMap[val] = []; 
        renderTags();
        renderColorUploaders();
        renderMatrix();
        input.value = "";
    }
};

document.getElementById('btn-add-cap').onclick = () => {
    const input = document.getElementById('new-cap-input');
    const val = input.value.trim();
    if(val && !definedCaps.includes(val)) {
        definedCaps.push(val);
        renderTags();
        renderMatrix();
        input.value = "";
    }
};

function renderTags() {
    document.getElementById('tags-colors').innerHTML = definedColors.map(c => `
        <span class="bg-brand-black text-white px-3 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-2">
            ${c} <button type="button" onclick="removeAttr('color', '${c}')" class="hover:text-red-400">×</button>
        </span>`).join('');
    document.getElementById('tags-caps').innerHTML = definedCaps.map(c => `
        <span class="bg-slate-200 text-gray-600 px-3 py-1 rounded-lg text-[10px] font-bold uppercase flex items-center gap-2">
            ${c} <button type="button" onclick="removeAttr('cap', '${c}')" class="hover:text-red-500">×</button>
        </span>`).join('');
}

window.removeAttr = (type, val) => {
    if(type === 'color') { definedColors = definedColors.filter(c => c !== val); delete colorImagesMap[val]; renderColorUploaders(); } 
    else { definedCaps = definedCaps.filter(c => c !== val); }
    renderTags(); renderMatrix(); 
};

// --- 3. SUBIDA POR COLOR ---
function renderColorUploaders() {
    const container = document.getElementById('color-uploaders-container');
    const section = document.getElementById('color-images-section');
    if(definedColors.length === 0) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    container.innerHTML = "";
    
    definedColors.forEach(color => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-4 bg-slate-50 p-3 rounded-xl border border-gray-100";
        
        let imagesHTML = (colorImagesMap[color] || []).map((file, idx) => `
            <div class="w-10 h-10 rounded-lg overflow-hidden border border-gray-200 bg-white relative group">
                <img src="${URL.createObjectURL(file)}" class="w-full h-full object-cover">
                <button type="button" onclick="removeColorImage('${color}', ${idx})" 
                    class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 text-white transition">
                    <i class="fa-solid fa-xmark text-[10px]"></i>
                </button>
            </div>
        `).join('');

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
    const validFiles = Array.from(files).filter(file => {
        if (VALID_IMAGE_TYPES.includes(file.type)) return true;
        hasInvalid = true;
        return false;
    });
    if (hasInvalid) alert("Formato inválido. Solo se admiten JPG, PNG y WEBP.");
    
    colorImagesMap[color] = [...colorImagesMap[color], ...validFiles]; 
    renderColorUploaders(); 
};

// --- 4. MATRIZ ---
function renderMatrix() {
    const tbody = document.getElementById('matrix-tbody');
    const globalSku = document.getElementById('p-sku').value.trim().toUpperCase(); 
    tbody.innerHTML = "";
    
    if(definedColors.length === 0 && definedCaps.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-300 text-xs">Producto Simple (El SKU se toma del campo principal)</td></tr>`;
        unlockGlobalInputs();
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
                <input type="text" value="${prev.sku}" 
                onchange="updateMatrixData('${row.key}', 'sku', this.value)" 
                class="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-gray-500 outline-none focus:border-brand-cyan focus:text-brand-black uppercase">
            </td>
            <td class="p-4"><input type="number" value="${prev.price}" onchange="updateMatrixData('${row.key}', 'price', this.value)" class="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-brand-cyan outline-none focus:border-brand-cyan"></td>
            <td class="p-4"><input type="number" value="${prev.stock}" onchange="updateMatrixData('${row.key}', 'stock', this.value)" class="w-full bg-white border border-gray-200 rounded-lg p-2 text-xs font-bold text-brand-black outline-none focus:border-brand-cyan"></td>`;
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
    if(field==='stock') recalcTotalStock(); 
};

function recalcTotalStock() {
    let total = 0;
    const activeKeys = [];
    if(definedColors.length > 0 && definedCaps.length > 0) definedColors.forEach(c => definedCaps.forEach(k => activeKeys.push(`${c}-${k}`)));
    else if(definedColors.length > 0) definedColors.forEach(c => activeKeys.push(c));
    else if(definedCaps.length > 0) definedCaps.forEach(k => activeKeys.push(k));
    activeKeys.forEach(k => total += (matrixData[k]?.stock || 0));
    stockInput.value = total;
}

function lockGlobalInputs() { 
    stockInput.readOnly = true; 
    stockInput.classList.add('bg-gray-100', 'text-gray-400'); 
    stockLabel.innerHTML = "Stock <span class='text-xs text-brand-cyan'>(Auto)</span>"; 
    
    const skuInput = document.getElementById('p-sku');
    skuInput.readOnly = true;
    skuInput.classList.replace('text-brand-black', 'text-gray-300');
    skuInput.classList.add('cursor-not-allowed');
    skuInput.title = "Para productos con variantes, define el SKU en la tabla de abajo.";
}

function unlockGlobalInputs() { 
    stockInput.readOnly = false; 
    stockInput.classList.remove('bg-gray-100', 'text-gray-400'); 
    stockLabel.innerHTML = "Stock <span class='text-brand-cyan'>(Manual)</span>"; 
    
    const skuInput = document.getElementById('p-sku');
    skuInput.readOnly = false;
    skuInput.classList.replace('text-gray-300', 'text-brand-black');
    skuInput.classList.remove('cursor-not-allowed');
    skuInput.title = "";
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
                    if (typeof sub === 'object' && sub !== null) subName = sub.name || sub.label || sub.value || "Subcategoría";
                    cachedCategories.push({ category: catName, subcategory: subName, searchStr: `${subName} ${catName}`.toLowerCase() });
                });
            } else {
                cachedCategories.push({ category: catName, subcategory: null, searchStr: catName.toLowerCase() });
            }
        });
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cachedCategories));
    } catch (e) { console.error("Error cargando categorías:", e); }
}

if (catSearchInput) {
    catSearchInput.addEventListener('focus', loadCategoriesToMemory);
    catSearchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (term.length < 1) { catResults.classList.add('hidden'); return; }
        const matches = cachedCategories.filter(item => item.searchStr.includes(term));
        catResults.innerHTML = '';
        if (matches.length === 0) {
            catResults.innerHTML = `<div class="p-3 text-xs text-gray-400 text-center">No encontrado</div>`;
        } else {
            matches.slice(0, 10).forEach(match => {
                const div = document.createElement('div');
                div.className = "p-4 hover:bg-brand-cyan/10 cursor-pointer text-xs font-bold rounded-xl flex justify-between items-center transition border-b border-gray-50 last:border-0";
                const subDisplay = match.subcategory ? match.subcategory : 'General';
                div.innerHTML = `<span class="text-brand-black">${subDisplay}</span><span class="text-[9px] text-gray-400 uppercase bg-gray-50 px-2 py-1 rounded-md border border-gray-100">${match.category}</span>`;
                div.onclick = () => { 
                    const displayVal = match.subcategory ? `${match.subcategory} (${match.category})` : match.category;
                    catSearchInput.value = displayVal; 
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

// --- GUARDAR ---
form.onsubmit = async (e) => {
    e.preventDefault();
    if (!pCategoryHidden.value) { alert("Selecciona una categoría."); return; }

    btnPublish.disabled = true;
    btnPublish.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> OPTIMIZANDO Y GUARDANDO...';

    try {
        // COMPRESIÓN Y SUBIDA GLOBAL
        const optimizedGlobalFiles = await Promise.all(globalFiles.map(item => compressImage(item.file)));
        const globalPromises = optimizedGlobalFiles.map(async (file) => {
            const refImg = ref(storage, `products/global/${Date.now()}_${file.name}`);
            await uploadBytes(refImg, file);
            return getDownloadURL(refImg);
        });
        const globalUrls = await Promise.all(globalPromises);

        // COMPRESIÓN Y SUBIDA POR COLOR
        const colorUrlsMap = {};
        const colorUploadPromises = [];

        for (const color of definedColors) {
            const rawFiles = colorImagesMap[color] || [];
            if (rawFiles.length > 0) {
                const colorPromise = (async () => {
                    const optimizedColorFiles = await Promise.all(rawFiles.map(file => compressImage(file)));
                    const urls = await Promise.all(optimizedColorFiles.map(async (file) => {
                        const refImg = ref(storage, `products/variants/${Date.now()}_${color}_${file.name}`);
                        await uploadBytes(refImg, file);
                        return getDownloadURL(refImg);
                    }));
                    colorUrlsMap[color] = urls;
                })();
                colorUploadPromises.push(colorPromise);
            }
        }
        await Promise.all(colorUploadPromises);

        // --- PREPARAR DATOS ---
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

        const productData = {
            name: document.getElementById('p-name').value,
            sku: document.getElementById('p-sku').value,
            brand: document.getElementById('p-brand').value,
            category: pCategoryHidden.value,
            subcategory: pSubCategoryHidden.value,
            description: descriptionEditor.innerHTML,
            status: document.getElementById('p-status').value, // 🔥 CORRECCIÓN AQUÍ: Toma del select "Borrador/Activo"
            createdAt: new Date(),
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
            images: globalUrls,
            colorImages: colorUrlsMap,
            mainImage: globalUrls[0] || (Object.values(colorUrlsMap)[0] ? Object.values(colorUrlsMap)[0][0] : '')
        };

        await addDoc(collection(db, "products"), productData);
        alert("✅ Producto guardado correctamente.");
        window.location.href = "products.html";

    } catch (e) { 
        console.error(e); 
        alert("Error: " + e.message); 
        btnPublish.disabled = false; 
        btnPublish.innerHTML = 'Publicar';
    }
};

window.formatDoc = (cmd, value = null) => { document.execCommand(cmd, false, value); descriptionEditor.focus(); };

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
                    if (!blob) { reject(new Error('Error al comprimir imagen')); return; }
                    const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
                    const newFile = new File([blob], newName, { type: 'image/webp', lastModified: Date.now() });
                    resolve(newFile);
                }, 'image/webp', quality);
            };
            img.onerror = (error) => reject(error);
        };
        reader.readAsDataURL(file);
    });
};