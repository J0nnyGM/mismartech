// public/js/admin/migrate-branches-stock.js
import { db, doc, collection, getDocs, updateDoc, writeBatch, setDoc } from '../firebase-init.js';

export async function runMigration() {
    console.log("🚀 Iniciando migración de inventario por sedes...");
    try {
        // 1. Crear sede por defecto si no existe
        const branchId = "sede_principal";
        const branchRef = doc(db, "branches", branchId);
        
        // Buscamos si existe alguna cuenta para vincularla a esta sede por defecto
        const accountsSnap = await getDocs(collection(db, "accounts"));
        let defaultAccountId = "";
        accountsSnap.forEach(d => {
            if (!defaultAccountId) defaultAccountId = d.id;
        });

        // Crear la sede principal
        await setDoc(branchRef, {
            name: "Sede Principal",
            accountId: defaultAccountId || null
        }, { merge: true });
        console.log("✅ Sede principal creada/verificada. Cuenta vinculada:", defaultAccountId || "Ninguna");

        // 2. Mapear stock de todos los productos
        const productsSnap = await getDocs(collection(db, "products"));
        let migratedCount = 0;
        const batch = writeBatch(db);

        productsSnap.forEach(productDoc => {
            const p = productDoc.data();
            let needsUpdate = false;
            const updateData = {};

            // Para producto simple o base
            if (!p.branchStock || Object.keys(p.branchStock).length === 0) {
                updateData.branchStock = {
                    [branchId]: p.stock || 0
                };
                needsUpdate = true;
            }

            // Para combinaciones
            if (p.combinations && Array.isArray(p.combinations)) {
                let combinationsChanged = false;
                const newCombinations = p.combinations.map(combo => {
                    if (!combo.branchStock || Object.keys(combo.branchStock).length === 0) {
                        combinationsChanged = true;
                        return {
                            ...combo,
                            branchStock: {
                                [branchId]: combo.stock || 0
                            }
                        };
                    }
                    return combo;
                });

                if (combinationsChanged) {
                    updateData.combinations = newCombinations;
                    needsUpdate = true;
                }
            }

            if (needsUpdate) {
                batch.update(doc(db, "products", productDoc.id), updateData);
                migratedCount++;
            }
        });

        if (migratedCount > 0) {
            await batch.commit();
            console.log(`✅ Migración completada. ${migratedCount} productos actualizados con stock en Sede Principal.`);
            alert(`✅ Migración completada con éxito. Se actualizaron ${migratedCount} productos.`);
        } else {
            console.log("ℹ️ No hay productos pendientes por migrar.");
            alert("ℹ️ No hay productos pendientes por migrar. Todo el inventario ya tiene stock mapeado por sedes.");
        }

    } catch (e) {
        console.error("❌ Error en la migración:", e);
        alert("❌ Error durante la migración: " + e.message);
    }
}
