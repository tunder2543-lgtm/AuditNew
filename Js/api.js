// ==========================================
//  Supabase API Service Configuration
// ==========================================

const SUPABASE_CONFIG = {
    // กำหนด URL และ KEY ของ Supabase ที่นี่เพื่อให้เชื่อมต่อได้ทันทีเมื่อ Deploy
    // (หากปล่อยว่างไว้ ระบบจะยังคงใช้ข้อมูลจาก localStorage ที่กรอกในหน้าตั้งค่า)
    URL: 'https://nfhfuybqhskzlllkgmyi.supabase.co',
    KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5maGZ1eWJxaHNremxsbGtnbXlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTI0MjI4OCwiZXhwIjoyMDgwODE4Mjg4fQ.crKVAeRVBA6m2h8KPKmtePKSjPyRiFqRdRU7pjuFxx0'
};

let _sbStorageWarned = false;

function readSupabaseStorage() {
    try {
        return {
            url: localStorage.getItem('SB_URL'),
            key: localStorage.getItem('SB_KEY')
        };
    } catch (err) {
        if (!_sbStorageWarned) {
            _sbStorageWarned = true;
            console.warn('[Supabase API] อ่าน localStorage ไม่ได้:', err);
            setTimeout(() => {
                if (typeof window.showToast === 'function') {
                    window.showToast(
                        'การตั้งค่า Supabase ในเบราว์เซอร์เสีย — ใช้ค่าเริ่มต้นจากระบบ',
                        'error'
                    );
                }
            }, 0);
        }
        return { url: null, key: null };
    }
}

function getSupabaseClient() {
    // 1. อ่านจาก localStorage ก่อน (กรณีผู้ใช้แก้ไขผ่านหน้า Settings Modal)
    let { url, key } = readSupabaseStorage();

    // 2. ถ้าใน localStorage ไม่มี ให้ใช้ค่าจาก Config ด้านบน
    if (!url || !key) {
        url = SUPABASE_CONFIG.URL;
        key = SUPABASE_CONFIG.KEY;

        // ถ้ามีการกำหนดค่าใน Config ให้บันทึกลง localStorage ด้วย เพื่อให้หน้า Settings แสดงผลตรงกัน
        if (url && key && url !== '' && key !== '') {
            localStorage.setItem('SB_URL', url);
            localStorage.setItem('SB_KEY', key);
        }
    }

    // 3. ตรวจสอบว่ามี URL และ KEY ครบถ้วนหรือไม่
    if (!url || !key || url === '' || key === '') {
        return null; // ยังไม่ได้ตั้งค่า
    }

    try {
        const lib = window.supabase || window.supabaseJs;
        if (!lib?.createClient) throw new Error('Supabase library not loaded');
        return lib.createClient(url, key);
    } catch (err) {
        console.error('[Supabase API] Init failed:', err);
        return null;
    }
}

// Export เป็นตัวแปร Global เพื่อให้ไฟล์อื่นเรียกใช้ได้
window.apiService = {
    SUPABASE_CONFIG,
    getClient: getSupabaseClient
};
