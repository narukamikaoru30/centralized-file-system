async function main() {
  const loginRes = await fetch('http://127.0.0.1:3002/auth/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'email=superadmin@doj-ppa.gov.ph&password=SuperAdmin@2026!'
  });

  console.log('login-status', loginRes.status);
  console.log('location', loginRes.headers.get('location'));
  const setCookieHeader = loginRes.headers.get('set-cookie') || '';
  console.log('set-cookie', setCookieHeader);

  const cookies = setCookieHeader
    .split(',')
    .map((part) => part.split(';')[0])
    .join('; ');

  const dashRes = await fetch('http://127.0.0.1:3002/auth/super', {
    redirect: 'manual',
    headers: { cookie: cookies }
  });

  console.log('super-status', dashRes.status);
  console.log('super-location', dashRes.headers.get('location'));
  console.log('super-body', (await dashRes.text()).slice(0, 500));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
