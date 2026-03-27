const { paginateArray } = require("../src/services/viewHelpers");

describe("viewHelpers.paginateArray", () => {
  const data = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));

  test("returns correct slice for page 1", () => {
    const res = paginateArray(data, { page: 1, pageSize: 10 });
    expect(res.slice).toHaveLength(10);
    expect(res.slice[0].id).toBe(1);
    expect(res.total).toBe(25);
    expect(res.totalPages).toBe(3);
  });

  test("returns correct slice for page 3", () => {
    const res = paginateArray(data, { page: 3, pageSize: 10 });
    expect(res.slice).toHaveLength(5);
    expect(res.slice[0].id).toBe(21);
  });

  test("handles empty array", () => {
    const res = paginateArray([], { page: 1, pageSize: 10 });
    expect(res.slice).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});
