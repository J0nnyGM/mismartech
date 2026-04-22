<section class="w-full px-4 md:px-[3%]">
    <div class="flex items-end gap-4 mb-6 md:mb-8 border-l-4 border-brand-cyan pl-4 md:pl-6">
        <div>
            <h2 class="text-3xl md:text-4xl font-black text-brand-black tracking-tighter uppercase leading-none">
                Destacados <span class="text-gray-300">Del Mes</span>
            </h2>
            <p class="text-[9px] md:text-[10px] font-bold text-gray-400 mt-2 uppercase tracking-widest">Selección exclusiva para ti</p>
        </div>
    </div>
    <div id="featured-grid" class="grid grid-cols-2 lg:grid-cols-5 gap-4 md:gap-6">
        <?php for($i=0; $i<5; $i++): ?>
        <div class="bg-white border border-gray-100 rounded-3xl p-4 flex flex-col animate-pulse h-[250px]">
            <div class="h-24 bg-gray-100 rounded-2xl mb-3 w-full"></div>
            <div class="h-2 bg-gray-200 rounded w-1/3 mb-2 mx-auto"></div>
            <div class="h-4 bg-gray-200 rounded w-3/4 mb-3 mx-auto"></div>
            <div class="mt-auto h-8 bg-gray-200 rounded-xl w-full"></div>
        </div>
        <?php endfor; ?>
    </div>
</section>

<section class="w-full bg-slate-50 py-10 md:py-16 rounded-[2.5rem] md:rounded-[3rem] relative overflow-hidden">
    <div class="absolute top-0 right-0 w-96 h-96 bg-brand-cyan/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
    <div class="px-4 md:px-[3%] relative z-10">
        <div class="text-center mb-8 md:mb-10">
            <h2 class="text-2xl md:text-3xl font-black text-brand-black tracking-tighter uppercase mb-6">Explora por <span class="text-brand-cyan">Categoría</span></h2>
            
            <div class="relative flex items-center justify-center max-w-6xl mx-auto group/cat">
                <button onclick="document.getElementById('categories-bar').scrollBy({left: -200, behavior: 'smooth'})" aria-label="Mover a la izquierda"
                    class="absolute left-0 z-20 w-8 h-8 md:w-10 md:h-10 bg-white border border-gray-100 rounded-full shadow-lg flex items-center justify-center text-brand-black hover:text-brand-cyan transition-all opacity-0 group-hover/cat:opacity-100 -translate-x-2 md:-translate-x-4">
                    <i class="fa-solid fa-chevron-left text-xs md:text-sm"></i>
                </button>

                <div id="categories-bar" class="flex gap-3 overflow-x-auto no-scrollbar py-4 px-4 w-full snap-x scroll-smooth mask-fade">
                    <?php for($i=0; $i<6; $i++): ?>
                        <div class="h-10 w-24 bg-gray-200 rounded-full animate-pulse shrink-0"></div>
                    <?php endfor; ?>
                </div>

                <button onclick="document.getElementById('categories-bar').scrollBy({left: 200, behavior: 'smooth'})" aria-label="Mover a la derecha"
                    class="absolute right-0 z-20 w-8 h-8 md:w-10 md:h-10 bg-white border border-gray-100 rounded-full shadow-lg flex items-center justify-center text-brand-black hover:text-brand-cyan transition-all opacity-0 group-hover/cat:opacity-100 translate-x-2 md:translate-x-4">
                    <i class="fa-solid fa-chevron-right text-xs md:text-sm"></i>
                </button>
            </div>
        </div>
        
        <div class="flex justify-between items-end mb-6 md:mb-8 px-2">
            <h3 id="section-title" class="text-lg md:text-xl font-black text-brand-black uppercase tracking-wide flex items-center gap-2"><i class="fa-solid fa-fire text-brand-red"></i> Los Más Vendidos</h3>
            <a href="/shop/catalog.html" class="text-[9px] md:text-[10px] font-black text-brand-cyan uppercase tracking-widest hover:underline">Ver Todo</a>
        </div>
        
        <div id="dynamic-grid" class="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-8">
            <?php for($i=0; $i<8; $i++): ?>
            <div class="bg-white border border-gray-100 rounded-3xl p-4 flex flex-col animate-pulse h-[320px]">
                <div class="h-36 bg-gray-100 rounded-2xl mb-4 w-full"></div>
                <div class="h-2 bg-gray-200 rounded w-1/3 mb-2 mx-auto"></div>
                <div class="h-5 bg-gray-200 rounded w-3/4 mb-4 mx-auto"></div>
                <div class="h-6 bg-gray-200 rounded w-1/2 mb-4 mx-auto"></div>
                <div class="mt-auto h-12 bg-gray-200 rounded-xl w-full"></div>
            </div>
            <?php endfor; ?>
        </div>
    </div>
</section>

<section class="w-full border-t border-gray-100 py-8 md:py-12 bg-white overflow-hidden">
    <div class="text-center mb-6 md:mb-8"><p class="text-[9px] font-black text-gray-300 uppercase tracking-[0.4em]">Nuestros Aliados Oficiales</p></div>
    <div class="relative w-full marquee-container">
        <div class="absolute left-0 top-0 bottom-0 w-12 md:w-20 bg-gradient-to-r from-white to-transparent z-10"></div>
        <div class="absolute right-0 top-0 bottom-0 w-12 md:w-20 bg-gradient-to-l from-white to-transparent z-10"></div>
        <div id="brands-track" class="flex items-center gap-8 md:gap-16 w-max animate-marquee">
            <?php for($i=0; $i<8; $i++): ?>
                <div class="w-32 h-20 bg-gray-100 rounded-2xl animate-pulse shrink-0"></div>
            <?php endfor; ?>
        </div>
    </div>
</section>