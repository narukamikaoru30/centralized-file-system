const { expect } = require('chai');
const {
  SUPER_ADMIN_ACTIVITY_ROOM,
  branchRoom,
  userRoom,
  getRecentActivityRoomsForUser,
  setRecentActivityIO,
  publishRecentActivity,
  dedupeRecentNotifications
} = require('../utils/recentActivity');

describe('Recent activity deduplication', () => {
  it('creates role-scoped activity rooms for each dashboard audience', () => {
    expect(getRecentActivityRoomsForUser({ _id: 'admin-1', role: 'admin', branch: 'North Branch' }))
      .to.deep.equal([userRoom('admin-1'), branchRoom('North Branch')]);
    expect(getRecentActivityRoomsForUser({ _id: 'user-1', role: 'user', branch: 'South/Branch' }))
      .to.deep.equal([userRoom('user-1'), branchRoom('South/Branch')]);
    expect(getRecentActivityRoomsForUser({ _id: 'super-1', role: 'super_admin' }))
      .to.deep.equal([userRoom('super-1'), SUPER_ADMIN_ACTIVITY_ROOM]);
  });

  it('broadcasts new activity to global, branch, and involved-user rooms', async () => {
    let emitted;
    const rooms = [];
    const fakeIo = {
      to(room) {
        rooms.push(room);
        const operator = {
          to(nextRoom) {
            rooms.push(nextRoom);
            return operator;
          },
          emit(event, payload) {
            emitted = { event, payload };
          }
        };
        return operator;
      }
    };

    setRecentActivityIO(fakeIo);
    await publishRecentActivity({
      _id: 'activity-test-id',
      message: 'A new upload',
      type: 'upload',
      date: new Date(),
      branch: 'Test Branch',
      owner: 'user-test-id',
      relatedUser: 'actor-test-id',
      relatedFile: 'file-test-id'
    });
    setRecentActivityIO(null);

    expect(rooms).to.deep.equal([
      SUPER_ADMIN_ACTIVITY_ROOM,
      branchRoom('Test Branch'),
      userRoom('user-test-id'),
      userRoom('actor-test-id')
    ]);
    expect(emitted.event).to.equal('recentActivity');
    expect(emitted.payload.id).to.equal('activity-test-id');
  });

  it('collapses fan-out copies of the same event across notification owners', () => {
    const copies = [
      {
        owner: 'admin-a',
        type: 'download',
        message: 'Alex downloaded report.pdf',
        relatedUser: 'alex',
        relatedFile: 'file-1',
        date: '2026-11-26T10:00:00.100Z'
      },
      {
        owner: 'admin-b',
        type: 'download',
        message: 'Alex downloaded report.pdf',
        relatedUser: 'alex',
        relatedFile: 'file-1',
        date: '2026-11-26T10:00:00.900Z'
      }
    ];

    expect(dedupeRecentNotifications(copies)).to.have.lengthOf(1);
    expect(dedupeRecentNotifications(copies)[0].owner).to.equal('admin-a');
  });

  it('keeps distinct events and applies the requested result limit', () => {
    const notifications = [
      { type: 'view', message: 'Viewed report', relatedUser: 'alex', relatedFile: 'file-1', date: '2026-11-26T10:00:00Z' },
      { type: 'view', message: 'Viewed report', relatedUser: 'alex', relatedFile: 'file-2', date: '2026-11-26T10:00:00Z' },
      { type: 'view', message: 'Viewed report', relatedUser: 'alex', relatedFile: 'file-1', date: '2026-11-26T10:01:00Z' }
    ];

    expect(dedupeRecentNotifications(notifications, 2)).to.have.lengthOf(2);
  });

  it('keeps up to 30 distinct items by default for the dashboard scroller', () => {
    const notifications = Array.from({ length: 35 }, (_, index) => ({
      type: 'general',
      message: `Activity ${index}`,
      date: new Date(Date.UTC(2026, 10, 26, 10, 0, index))
    }));

    expect(dedupeRecentNotifications(notifications)).to.have.lengthOf(30);
  });
});