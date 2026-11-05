-- Migration 0001: seed default units and warehouses
INSERT OR IGNORE INTO units (id, code, name_th, decimal_places) VALUES
  (1, 'PCS', 'ชิ้น', 0),
  (2, 'SET', 'เครื่อง', 0),
  (3, 'ROLL', 'ม้วน', 0),
  (4, 'BOX', 'กล่อง', 0),
  (5, 'KG', 'กก.', 3);

INSERT OR IGNORE INTO warehouses (id, code, name, is_active) VALUES
  (1, 'WH01', 'คลังหลัก', 1),
  (2, 'WH02', 'คลังสาขา', 1);
