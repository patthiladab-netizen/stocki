-- กันยอดติดลบที่ฐานข้อมูล: ถ้าการตัดสต็อกทำให้ยอดติดลบ ทั้ง db.batch() จะถูกยกเลิก
-- (UPDATE ... WHERE qty >= ? ที่แก้ 0 แถวใน batch ตรวจไม่ได้ เพราะ D1 ไม่มี interactive transaction)
CREATE TRIGGER IF NOT EXISTS stock_balances_no_negative_update
BEFORE UPDATE OF qty_on_hand_milli ON stock_balances
WHEN NEW.qty_on_hand_milli < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_stock');
END;

CREATE TRIGGER IF NOT EXISTS stock_balances_no_negative_insert
BEFORE INSERT ON stock_balances
WHEN NEW.qty_on_hand_milli < 0
BEGIN
  SELECT RAISE(ABORT, 'insufficient_stock');
END;
