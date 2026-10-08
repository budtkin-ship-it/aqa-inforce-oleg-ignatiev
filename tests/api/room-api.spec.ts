import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext } from '@playwright/test';

test.setTimeout(60_000);

async function loginAsAdmin(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', {
    data: { username: 'admin', password: 'password' },
  });
  expect(response.status()).toBe(200);
  const { token } = await response.json();
  return { Cookie: `token=${token}` };
}

async function createRoom(request: APIRequestContext, headers: { Cookie: string }) {
  const data = {
    roomName: `Q${randomUUID().slice(0, 6)}`,
    type: 'Double',
    accessible: true,
    description: 'API automation test room',
    image: 'https://www.mwtestconsultancy.co.uk/img/room1.jpg',
    roomPrice: '123',
    features: ['WiFi', 'Safe'],
  };
  const response = await request.post('/api/room', { headers, data });
  expect(response.status()).toBe(200);

  // Creation returns success only, so retrieve the room from the public list.
  const list = await request.get('/api/room');
  const { rooms } = await list.json();
  const room = rooms.find((room: { roomName: string }) => room.roomName === data.roomName);
  expect(room, 'The created room should appear in the public room list').toBeDefined();
  return { room, data };
}

async function deleteRoom(request: APIRequestContext, roomId: number) {
  const headers = await loginAsAdmin(request);
  const response = await request.delete(`/api/room/${roomId}`, { headers });
  expect(response.status()).toBe(202);
}

test('API-001: create a room through Admin API and verify it through public API', async ({ request }) => {
  const headers = await loginAsAdmin(request);
  const { room, data } = await createRoom(request, headers);
  try {
    expect(room).toMatchObject({ ...data, roomPrice: 123 });
  } finally {
    await deleteRoom(request, room.roomid);
  }
});

test('API-002: book a room through User API and verify it through Admin API', async ({ request }) => {
  const reportResponse = await request.get('/api/report/room/1');
  const { report } = await reportResponse.json() as { report: { start: string; end: string }[] };
  const today = new Date();
  let bookingdates: { checkin: string; checkout: string } | undefined;
  for (let offset = 0; offset < 3; offset++) {
    const checkin = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 4, 10 + offset * 3));
    const checkout = new Date(checkin);
    checkout.setUTCDate(checkout.getUTCDate() + 2);
    const dates = { checkin: checkin.toISOString().slice(0, 10), checkout: checkout.toISOString().slice(0, 10) };
    if (!report.some(entry => dates.checkin < entry.end && dates.checkout > entry.start)) {
      bookingdates = dates;
      break;
    }
  }
  expect(bookingdates, 'Room 1 should have a free future date range').toBeDefined();

  const suffix = randomUUID().slice(0, 8);
  const data = {
    roomid: 1,
    firstname: 'Alex',
    lastname: `Tester${suffix}`,
    depositpaid: false,
    bookingdates,
    email: `qa.${suffix}@example.com`,
    phone: '01234567890',
  };
  const response = await request.post('/api/booking', { data });
  const { bookingid } = await response.json();
  try {
    expect(response.status()).toBe(201);
    const headers = await loginAsAdmin(request);
    const list = await request.get('/api/booking?roomid=1', { headers });
    const { bookings } = await list.json();
    expect(bookings).toContainEqual(expect.objectContaining({
      bookingid,
      roomid: 1,
      firstname: data.firstname,
      lastname: data.lastname,
      depositpaid: false,
      bookingdates,
    }));
  } finally {
    if (bookingid !== undefined) {
      const headers = await loginAsAdmin(request);
      const deleted = await request.delete(`/api/booking/${bookingid}`, { headers });
      expect(deleted.status()).toBe(202);
    }
  }
});

test('API-003: edit a room through Admin API and verify changes through public API', async ({ request }) => {
  const headers = await loginAsAdmin(request);
  const { room, data } = await createRoom(request, headers);
  const changes = {
    type: 'Suite',
    accessible: false,
    description: 'Updated API automation test room',
    roomPrice: '175',
    features: ['TV', 'Views'],
  };
  try {
    const updated = await request.put(`/api/room/${room.roomid}`, {
      headers,
      data: {
        ...data,
        ...changes,
        roomid: room.roomid,
        featuresObject: { WiFi: false, TV: true, Radio: false, Refreshments: false, Safe: false, Views: true },
      },
    });
    expect(updated.status()).toBe(202);
    const publicRoom = await request.get(`/api/room/${room.roomid}`);
    expect(await publicRoom.json()).toMatchObject({ ...changes, roomid: room.roomid, roomPrice: 175 });
  } finally {
    await deleteRoom(request, room.roomid);
  }
});

test('API-004: delete a room through Admin API and verify deletion through public API', async ({ request }) => {
  const headers = await loginAsAdmin(request);
  const { room } = await createRoom(request, headers);
  let deleted = false;
  try {
    await deleteRoom(request, room.roomid);
    deleted = true;
    const list = await request.get('/api/room');
    const { rooms } = await list.json();
    expect(rooms).not.toContainEqual(expect.objectContaining({ roomid: room.roomid }));
  } finally {
    if (!deleted) await deleteRoom(request, room.roomid);
  }
});
