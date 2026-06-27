import { useEffect, useState } from 'react';
import { Button, message, Space, Table, Tag } from 'antd';
import { CheckOutlined, PauseOutlined } from '@ant-design/icons';
import { api } from '../api/client';

interface Shop {
  id: string;
  name: string;
  phone: string;
  address: string;
  status: 'pending' | 'active' | 'suspended';
  createdAt: string;
}

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  pending: { color: 'gold', text: '待审核' },
  active: { color: 'green', text: '营业中' },
  suspended: { color: 'red', text: '已暂停' },
};

export default function Shops() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get<Shop[]>('/api/admin/shops').then(setShops).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const audit = async (id: string, status: string) => {
    try {
      await api.put('/api/admin/shops/' + id + '/audit', { status });
      message.success(status === 'active' ? '已通过审核' : '已暂停');
      load();
    } catch { message.error('操作失败'); }
  };

  const columns = [
    { title: '店铺名', dataIndex: 'name', key: 'name' },
    { title: '电话', dataIndex: 'phone', key: 'phone' },
    { title: '地址', dataIndex: 'address', key: 'address' },
    {
      title: '状态', dataIndex: 'status', key: 'status',
      render: (s: string) => {
        const cfg = STATUS_MAP[s] || { color: 'default', text: s };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '操作', key: 'actions',
      render: (_: unknown, record: Shop) => (
        <Space>
          {record.status === 'pending' && (
            <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => audit(record.id, 'active')}>
              通过
            </Button>
          )}
          {record.status === 'active' && (
            <Button danger size="small" icon={<PauseOutlined />} onClick={() => audit(record.id, 'suspended')}>
              暂停
            </Button>
          )}
          {record.status === 'suspended' && (
            <Button size="small" icon={<CheckOutlined />} onClick={() => audit(record.id, 'active')}>
              恢复
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return <Table rowKey="id" columns={columns} dataSource={shops} loading={loading} />;
}
