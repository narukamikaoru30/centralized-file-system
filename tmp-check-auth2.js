const http = require('http');
const qs = require('querystring');

async function main() {
  const loginData = qs.stringify({ email: 'superadmin@doj-ppa.gov.ph', password: 'SuperAdmin@2026!' });

  const loginRes = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3001,
      path: '/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(loginData)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.write(loginData);
    req.end();
  });

  console.log('login-status', loginRes.statusCode);
  console.log('login-location', loginRes.headers.location);
  const cookies = (loginRes.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  console.log('cookies', cookies);

  const dashRes = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 3001,
      path: '/auth/super',
      method: 'GET',
      headers: { Cookie: cookies }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

  console.log('super-status', dashRes.statusCode);
  console.log('super-location', dashRes.headers.location);
  console.log(dashRes.body.slice(0, 400));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
