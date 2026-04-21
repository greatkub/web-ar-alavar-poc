import { supabase } from './supabase.js';

const BUCKET = 'plant-images';

/**
 * Upload an image file and insert a plant collection row.
 *
 * @param {string} userId - The authenticated user's UUID.
 * @param {{ tree_name: string, tree_species?: string, confidence?: number,
 *           image_summary?: string, carbon_credit_estimate?: number, notes?: string }} treeData
 * @param {File|Blob} imageFile - The captured image to store.
 * @returns {Promise<{ data: object|null, error: Error|null }>}
 */
export async function addPlantEntry(userId, treeData, imageFile) {
    // 1. Upload image to storage
    const ext = imageFile.type === 'image/png' ? 'png'
              : imageFile.type === 'image/webp' ? 'webp'
              : 'jpg';
    const imagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(imagePath, imageFile, { contentType: imageFile.type, upsert: false });

    if (uploadError) {
        return { data: null, error: uploadError };
    }

    // 2. Insert row
    const { data, error: insertError } = await supabase
        .from('plant_collections')
        .insert({
            user_id: userId,
            tree_name: treeData.tree_name,
            tree_species: treeData.tree_species ?? null,
            confidence: treeData.confidence ?? null,
            image_summary: treeData.image_summary ?? null,
            carbon_credit_estimate: treeData.carbon_credit_estimate ?? null,
            notes: treeData.notes ?? null,
            image_path: imagePath,
        })
        .select()
        .single();

    if (insertError) {
        // Clean up the orphaned upload on insert failure
        await supabase.storage.from(BUCKET).remove([imagePath]);
        return { data: null, error: insertError };
    }

    return { data, error: null };
}

/**
 * Fetch all plant collection entries for the authenticated user.
 *
 * @param {string} userId - The authenticated user's UUID.
 * @returns {Promise<{ data: object[]|null, error: Error|null }>}
 */
export async function getUserPlants(userId) {
    const { data, error } = await supabase
        .from('plant_collections')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    return { data, error };
}

/**
 * Delete a plant collection entry and its associated image.
 *
 * @param {string} id - The row UUID to delete.
 * @param {string|null} imagePath - The storage object path to remove.
 * @returns {Promise<{ error: Error|null }>}
 */
export async function deletePlantEntry(id, imagePath) {
    const { error: deleteError } = await supabase
        .from('plant_collections')
        .delete()
        .eq('id', id);

    if (deleteError) {
        return { error: deleteError };
    }

    if (imagePath) {
        const { error: storageError } = await supabase.storage
            .from(BUCKET)
            .remove([imagePath]);

        if (storageError) {
            return { error: storageError };
        }
    }

    return { error: null };
}

/**
 * Generate a short-lived signed URL for a stored plant image.
 *
 * @param {string} imagePath - The storage object path.
 * @param {number} [expiresIn=3600] - Seconds until the URL expires.
 * @returns {Promise<{ url: string|null, error: Error|null }>}
 */
export async function getImageUrl(imagePath, expiresIn = 3600) {
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(imagePath, expiresIn);

    return { url: data?.signedUrl ?? null, error };
}
