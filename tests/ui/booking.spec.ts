import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

type Dates = { checkin: string; checkout: string };

test.use({ locale: 'en-GB' });
test.setTimeout(60_000);

async function futureDates(request: APIRequestContext, day: number): Promise<Dates> {
  const response = await request.get('/api/report/room/1');
  expect(response.status()).toBe(200);
  const { report } = await response.json() as { report: { start: string; end: string }[] };
  const today = new Date();
  for (let offset = 0; offset < 3; offset++) {
    const checkin = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, day + offset * 3));
    const checkout = new Date(checkin);
    checkout.setUTCDate(checkout.getUTCDate() + 2);
    if (checkout.getUTCMonth() !== checkin.getUTCMonth()) break;
    const dates = {
      checkin: checkin.toISOString().slice(0, 10),
      checkout: checkout.toISOString().slice(0, 10),
    };
    if (!report.some(entry => dates.checkin < entry.end && dates.checkout > entry.start)) return dates;
  }
  throw new Error('No free range found among the candidate dates for room 1.');
}

async function openBookingPage(page: Page, dates: Dates) {
  await page.goto('/');
  for (const [label, date] of [['Check In', dates.checkin], ['Check Out', dates.checkout]]) {
    // The application's date labels point to missing input IDs.
    const input = page.getByText(label, { exact: true }).locator('..').getByRole('textbox');
    await input.fill(date.split('-').reverse().join('/'));
    await input.press('Tab');
  }
  const availability = page.waitForResponse(response => response.url().includes('/api/room?'));
  await page.getByRole('button', { name: 'Check Availability', exact: true }).click();
  await availability;

  const roomLink = page.getByRole('link', { name: 'Book now', exact: true }).first();
  await expect(roomLink).toHaveAttribute('href', `/reservation/1?checkin=${dates.checkin}&checkout=${dates.checkout}`);
  await roomLink.click();
  await expect(page.getByRole('button', { name: 'Reserve Now', exact: true })).toBeVisible();
}

async function deleteBooking(request: APIRequestContext, bookingId: number | undefined) {
  if (bookingId === undefined) return;
  const login = await request.post('/api/auth/login', {
    data: { username: 'admin', password: 'password' },
  });
  expect(login.status()).toBe(200);
  const { token } = await login.json();
  const response = await request.delete(`/api/booking/${bookingId}`, {
    headers: { Cookie: `token=${token}` },
  });
  expect(response.status()).toBe(202);
}

// UI-001: Valid room booking
test('UI-001: a room can be booked with valid data', async ({ page, request }) => {
  const dates = await futureDates(request, 10);
  const suffix = Date.now();
  let bookingId: number | undefined;
  try {
    await openBookingPage(page, dates);
    await page.getByRole('button', { name: 'Reserve Now', exact: true }).click();
    await page.getByPlaceholder('Firstname', { exact: true }).fill('Alex');
    await page.getByPlaceholder('Lastname', { exact: true }).fill(`Tester${suffix}`);
    await page.getByPlaceholder('Email', { exact: true }).fill(`qa.${suffix}@example.com`);
    await page.getByPlaceholder('Phone', { exact: true }).fill('01234567890');

    const bookingResponse = page.waitForResponse(response =>
      response.url().endsWith('/api/booking') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Reserve Now', exact: true }).click();
    const response = await bookingResponse;
    bookingId = (await response.json()).bookingid;
    expect(response.status()).toBe(201);
    await expect(page.getByText('Booking Confirmed', { exact: true })).toBeVisible();
    await expect(page.getByText(`${dates.checkin} - ${dates.checkout}`, { exact: true })).toBeVisible();
  } finally {
    await deleteBooking(request, bookingId);
  }
});

// UI-002: Invalid room booking
test('UI-002: a room cannot be booked with invalid data', async ({ page, request }) => {
  await openBookingPage(page, await futureDates(request, 14));
  await page.getByRole('button', { name: 'Reserve Now', exact: true }).click();
  await page.getByPlaceholder('Firstname', { exact: true }).fill('Al');
  await page.getByPlaceholder('Lastname', { exact: true }).fill('Tester');
  await page.getByPlaceholder('Email', { exact: true }).fill('qa.manual@example.com');
  await page.getByPlaceholder('Phone', { exact: true }).fill('01234567890');
  await page.getByRole('button', { name: 'Reserve Now', exact: true }).click();

  await expect(page.getByText('size must be between 3 and 18', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Firstname', { exact: true })).toBeVisible();
  await expect(page.getByText('Booking Confirmed', { exact: true })).toHaveCount(0);
});

// UI-003: Previously booked dates
test('UI-003: previously booked dates are shown as unavailable', async ({ page, request }) => {
  const dates = await futureDates(request, 18);
  const suffix = Date.now();
  const response = await request.post('/api/booking', {
    data: {
      roomid: 1,
      firstname: 'Alex',
      lastname: `Tester${suffix}`,
      email: `qa.${suffix}@example.com`,
      phone: '01234567890',
      depositpaid: false,
      bookingdates: dates,
    },
  });
  const { bookingid } = await response.json();
  try {
    expect(response.status()).toBe(201);
    const otherDates = await futureDates(request, 25);
    const calendarResponse = page.waitForResponse(response => response.url().endsWith('/api/report/room/1'));
    await openBookingPage(page, otherDates);
    const { report } = await (await calendarResponse).json();
    expect(report).toContainEqual({ start: dates.checkin, end: dates.checkout, title: 'Unavailable' });

    for (let month = 0; month < 3; month++) {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
    }
    const monthLabel = new Date(dates.checkin).toLocaleDateString('en-GB', {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    });
    await expect(page.getByText(monthLabel, { exact: true })).toBeVisible();
    const bookedWeek = page.getByRole('table', { name: 'Month View' }).getByRole('rowgroup').filter({
      has: page.getByRole('button', { name: dates.checkin.slice(-2), exact: true }),
    });
    await expect(bookedWeek).toHaveCount(1);
    // Keep the required assertion while the known calendar defect exists.
    await expect(bookedWeek.getByText('Unavailable', { exact: true })).toBeVisible();
  } finally {
    await deleteBooking(request, bookingid);
  }
});
