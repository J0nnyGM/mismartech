import { SmartCache } from "./cache-service.js";

const grid = document.getElementById('brands-grid');

function renderGrid() {
    grid.innerHTML = ""; 

    const brandsData = SmartCache.getBrands();

    if (brandsData.length === 0) {
        grid.innerHTML = `<p class="col-span-full text-center text-gray-400 font-bold uppercase py-10">No hay marcas registradas.</p>`;
        return;
    }

    brandsData.forEach((brand) => {
        const imageSrc = brand.image || 'https://placehold.co/400x300?text=' + encodeURIComponent(brand.name || 'Marca');
        
        const card = document.createElement('a');
        card.href = `/shop/search.html?brand=${encodeURIComponent(brand.name)}`;
        
        // Estilo premium de mismartech
        card.className = "group relative bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-[0_4px_25px_rgba(0,0,0,0.02)] hover:shadow-[0_20px_50px_rgba(240,90,40,0.15)] hover:border-brand-orange/30 transition-all duration-500 hover:-translate-y-2.5 cursor-pointer h-56 flex flex-col p-6 justify-center items-center animate-in fade-in duration-300";

        card.innerHTML = `
            <!-- Contenedor del Logo con fondo sutil en hover -->
            <div class="h-32 w-full flex items-center justify-center rounded-3xl group-hover:bg-orange-50/50 transition-colors duration-500 p-4">
                <img src="${imageSrc}" alt="${brand.name}" class="max-h-full max-w-full object-contain mix-blend-multiply opacity-80 group-hover:opacity-100 group-hover:scale-110 transition duration-500 drop-shadow-sm group-hover:drop-shadow-md">
            </div>

            <!-- Nombre de marca y flecha indicadora -->
            <div class="mt-4 flex items-center justify-between w-full px-2">
                <h3 class="text-brand-black font-black text-xs uppercase tracking-widest group-hover:text-brand-orange transition-colors">
                    ${brand.name}
                </h3>
                <i class="fa-solid fa-arrow-right text-[10px] text-brand-orange opacity-0 transform -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300"></i>
            </div>
            
            <!-- Badge flotante de Ver Productos -->
            <div class="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition duration-300 transform translate-y-1 group-hover:translate-y-0">
                <span class="bg-brand-black text-white text-[8px] font-black px-2.5 py-1 rounded-lg uppercase tracking-widest shadow-sm">Ver Productos</span>
            </div>
        `;

        grid.appendChild(card);
    });
}

async function initBrandsPage() {
    try {
        await SmartCache.init();
    } catch (e) {
        console.warn("Error initializing SmartCache on Brands page", e);
    }
    renderGrid();
    window.addEventListener('brandsUpdated', renderGrid);
}

document.addEventListener('DOMContentLoaded', initBrandsPage);