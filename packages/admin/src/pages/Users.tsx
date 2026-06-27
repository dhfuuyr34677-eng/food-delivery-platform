import { useEffect, useState } from 'react';
import { Table } from 'antd';
import { api } from '../api/client';

interface User {
  id: string;
  nickname: string;
  phone: string;
  createdAt: string;
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<User[]>('/api/admin/users').then(setUsers).finally(() => setLoading(false));
  }, []);

  const columns = [
    { title: '昵称', dataIndex: 'nickname', key: 'nickname' },
    { title: '手机号', dataIndex: 'phone', key: 'phone' },
    { title: '注册时间', dataIndex: 'createdAt', key: 'createdAt' },
  ];

  return <Table rowKey="id" columns={columns} dataSource={users} loading={loading} />;
}
