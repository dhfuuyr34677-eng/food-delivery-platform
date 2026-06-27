import { useEffect, useState } from 'react';
import { Button, message, Space, Table, Tag } from 'antd';
import { api } from '../api/client';

interface Order {
  id: string;
  orderNo: string;
  status: string;
  totalAmount: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'blue',
  confirmed: 'cyan',
  preparing: 'geekblue',
  delivering: 'purple',
  completed: 'green',
  cancelled: 'default',
};

const STATUS_NAMES: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  preparing: '制作中',
  delivering: '配送中',
  completed: '已完成',
  cancelled: '已取消',
};

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<Order[]>('/api/admin/orders').then(setOrders).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const cancel = async (id: string) => {
    try {
      await api.post('/api/admin/orders/' + id + '/cancel');
      message.success('已取消');
      load();
    } catch { message.error('操作失败'); }
  };

  const columns = [
    { title: '订单号', dataIndex: 'orderNo', key: 'orderNo' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => <Tag color={STATUS_COLORS[s] || 'default'}>{STATUS_NAMES[s] || s}</Tag>,
    },
    {
      title: '金额', dataIndex: 'totalAmount', key: 'totalAmount',
      render: (v: number) => '¥' + ((v || 0) / 100).toFixed(2),
    },
    { title: '下单时间', dataIndex: 'createdAt', key: 'createdAt' },
    {
      title: '操作', key: 'actions',
      render: (_: unknown, record: Order) =>
        (record.status === 'pending' || record.status === 'preparing') ? (
          <Button danger size="small" onClick={() => cancel(record.id)}>取消</Button>
        ) : null,
    },
  ];

  return <Table rowKey="id" columns={columns} dataSource={orders} loading={loading} />;
}
