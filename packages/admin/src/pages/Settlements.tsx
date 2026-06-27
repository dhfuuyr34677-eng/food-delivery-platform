import { useEffect, useState } from 'react';
import { Button, message, Modal, Select, Space, Table, Tag } from 'antd';
import { api } from '../api/client';

interface Settlement {
  id: string;
  shopId: string;
  totalAmount: number;
  commission: number;
  netAmount: number;
  totalOrders: number;
  status: 'pending' | 'settled' | 'paid';
  periodStart: string;
  periodEnd: string;
}

interface Shop {
  id: string;
  name: string;
}

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  pending: { color: 'gold', text: '待结算' },
  settled: { color: 'blue', text: '已结算' },
  paid: { color: 'green', text: '已打款' },
};

export default function Settlements() {
  const [list, setList] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [genShopId, setGenShopId] = useState<string>();
  const [shops, setShops] = useState<Shop[]>([]);

  const loadList = () => {
    setLoading(true);
    api.get<Settlement[]>('/api/admin/settlements').then(setList).finally(() => setLoading(false));
  };

  const loadShops = async () => {
    const data = await api.get<Shop[]>('/api/admin/shops');
    setShops(data);
  };

  useEffect(() => { loadList(); loadShops(); }, []);

  const generate = async () => {
    if (!genShopId) return;
    try {
      await api.post('/api/admin/settlements/generate', { shopId: genShopId });
      message.success('结算已生成');
      setGenOpen(false);
      loadList();
    } catch { message.error('操作失败'); }
  };

  const pay = async (id: string) => {
    try {
      await api.post('/api/admin/settlements/' + id + '/pay');
      message.success('已标记打款');
      loadList();
    } catch { message.error('操作失败'); }
  };

  const columns = [
    {
      title: '金额', dataIndex: 'totalAmount', key: 'totalAmount',
      render: (v: number) => '¥' + ((v || 0) / 100).toFixed(2),
    },
    {
      title: '佣金', dataIndex: 'commission', key: 'commission',
      render: (v: number) => '¥' + ((v || 0) / 100).toFixed(2),
    },
    {
      title: '净额', dataIndex: 'netAmount', key: 'netAmount',
      render: (v: number) => '¥' + ((v || 0) / 100).toFixed(2),
    },
    { title: '订单数', dataIndex: 'totalOrders', key: 'totalOrders' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => {
        const cfg = STATUS_MAP[s] || { color: 'default', text: s };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '结算周期', key: 'period',
      render: (_: unknown, r: Settlement) => r.periodStart + ' ~ ' + r.periodEnd,
    },
    {
      title: '操作', key: 'actions',
      render: (_: unknown, record: Settlement) =>
        record.status === 'settled' ? (
          <Button size="small" type="primary" onClick={() => pay(record.id)}>标记打款</Button>
        ) : null,
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => setGenOpen(true)}>生成结算</Button>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={list} loading={loading} />

      <Modal title="生成结算" open={genOpen} onOk={generate} onCancel={() => setGenOpen(false)}>
        <Select
          style={{ width: '100%' }}
          placeholder="选择店铺"
          value={genShopId}
          onChange={setGenShopId}
          options={shops.map((s) => ({ label: s.name, value: s.id }))}
        />
      </Modal>
    </>
  );
}
