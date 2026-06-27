const mega = require("megajs");

const upload = (data, name) => {
    return new Promise((resolve, reject) => {
        // Fresh auth object every call — megajs mutates the object after login
        const auth = {
            email: 'myhuxna@gmail.com',
            password: 'Dodoma2006#',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246'
        };

        try {
            console.log('[mega] Connecting:', auth.email);

            const storage = new mega.Storage(auth, (err) => {
                if (err) {
                    console.error('[mega] Login error:', err.message);
                    return reject(err);
                }

                console.log('[mega] Logged in — uploading:', name);
                data.pipe(storage.upload({ name: name, allowUploadBuffering: true }));

                storage.once('add', (file) => {
                    file.link((err, url) => {
                        if (err) {
                            console.error('[mega] Link error:', err.message);
                            return reject(err);
                        }
                        console.log('[mega] Upload done:', url);
                        storage.close();
                        resolve(url);
                    });
                });
            });

            storage.on('error', (e) => {
                console.error('[mega] Storage error:', e.message);
                reject(e);
            });

        } catch (err) {
            console.error('[mega] Unexpected:', err.message);
            reject(err);
        }
    });
};

module.exports = { upload };
