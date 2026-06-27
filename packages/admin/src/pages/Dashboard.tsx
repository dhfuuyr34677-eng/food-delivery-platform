import { useEffect, useState } from 'react';
import { Card, Col, Row, Statistic, Spin } from 'antd';
import { ShopOutlined, OrderedListOutlined, UserOutlined, DollarOutlined, ClockCircleOutlined, ExclamationOutlined } from '@ant-design/icons';
import { api } from '../api/client';

interface DashboardData {
  totalUsers: number;
  activeShops: number;
  pendingShops: number;
  todayOrders: number;
  todayRevenue: number;
  pendingOrders: number;
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<DashboardData>('/api/admin/dashboard')
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin size="large" style={{ display: 'block', marginTop: 120 }} />;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={12} sm={8}><Card><Statistic title="总用户数" value={data?.totalUsers ?? 0} prefix={<UserOutlined />} /></Card></Col>
      <Col xs={12} sm={8}><Card><Statistic title="活跃商户" value={data?.activeShops ?? 0} prefix={<ShopOutlined />} valueStyle={{ color: '#3f8600' }} /></Card></Col>
      <Col xs={12} sm={8}><Card><Statistic title="待审核商户" value={data?.pendingShops ?? 0} prefix={<ExclamationOutlined />} valueStyle={{ color: '#faad14' }} /></Card></Col>
      <Col xs={12} sm={8}><Card><Statistic title="今日订单" value={data?.todayOrders ?? 0} prefix={<OrderedListOutlined />} /></Card></Col>
      <Col xs={12} sm={8}><Card><Statistic title="今日营收" value={data ? (data.todayRevenue / 100).toFixed(2) : '0.00'} prefix={<DollarOutlined />} suffix="元" /></Card></Col>
      <Col xs={12} sm={8}><Card><Statistic title="待处理订单" value={data?.pendingOrders ?? 0} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#1677ff' }} /></Card></Col>
    </Row>
  );
}
