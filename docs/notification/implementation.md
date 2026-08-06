# Notification Implementation

---

## Folder Structure

```
backend/src/notification/
├── notification.controller.ts
├── notification.service.ts
├── notification.worker.ts
├── notification.module.ts
├── email.service.ts
├── push.service.ts
├── websocket.gateway.ts
├── dto/
│   ├── notification.dto.ts
│   └── preferences.dto.ts
└── __tests__/
    ├── notification.service.spec.ts
    └── notification.worker.spec.ts

frontend/src/features/notifications/
├── components/
│   ├── NotificationBell.tsx
│   ├── NotificationDropdown.tsx
│   ├── NotificationList.tsx
│   └── NotificationItem.tsx
├── hooks/
│   ├── useNotifications.ts
│   └── useWebSocket.ts
└── api/
    └── notificationApi.ts
```

---

## Packages

### Backend

```json
{
  "dependencies": {
    "@nestjs/websockets": "^10.0.0",
    "@nestjs/platform-socket.io": "^10.0.0",
    "bull": "^4.10.0",
    "@sendgrid/mail": "^7.7.0",
    "socket.io": "^4.6.0",
    "ioredis": "^5.3.0"
  }
}
```

### Frontend

```json
{
  "dependencies": {
    "socket.io-client": "^4.6.0",
    "react-query": "^3.39.0"
  }
}
```

---

## Code Snippets

### Backend: NotificationService

```typescript
@Injectable()
export class NotificationService {
  constructor(
    private notificationRepository: NotificationRepository,
    private queue: Queue,
    private websocketGateway: WebSocketGateway,
  ) {}

  async create(
    userId: string,
    type: NotificationType,
    data: CreateNotificationDto
  ): Promise<Notification> {
    const notification = await this.notificationRepository.create({
      userId,
      type,
      title: data.title,
      body: data.body,
      metadata: data.metadata,
      read: false,
    });

    // Enqueue for async processing
    await this.queue.add('process-notification', {
      notificationId: notification.id,
      userId,
    });

    // Send real-time update immediately
    this.websocketGateway.sendToUser(userId, 'notification:new', notification);

    return notification;
  }

  async findByUser(
    userId: string,
    query: QueryDto
  ): Promise<{ items: Notification[]; total: number }> {
    const { limit = 20, offset = 0, read } = query;
    
    const filter: any = { userId };
    if (read !== undefined) {
      filter.read = read;
    }

    const [items, total] = await Promise.all([
      this.notificationRepository.find(filter, { limit, offset, sort: { createdAt: -1 } }),
      this.notificationRepository.count(filter),
    ]);

    return { items, total };
  }

  async markAsRead(id: string, userId: string): Promise<void> {
    await this.notificationRepository.updateOne(
      { _id: id, userId },
      { read: true, readAt: new Date() }
    );

    this.websocketGateway.sendToUser(userId, 'notification:read', { id });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.updateMany(
      { userId, read: false },
      { read: true, readAt: new Date() }
    );

    this.websocketGateway.sendToUser(userId, 'notification:all-read', {});
  }
}
```

### Backend: NotificationWorker

```typescript
@Processor('notification')
export class NotificationWorker {
  constructor(
    private notificationRepository: NotificationRepository,
    private emailService: EmailService,
    private pushService: PushService,
    private preferencesRepository: PreferencesRepository,
  ) {}

  @Process('process-notification')
  async handleNotification(job: Job) {
    const { notificationId, userId } = job.data;

    const [notification, preferences] = await Promise.all([
      this.notificationRepository.findById(notificationId),
      this.preferencesRepository.findByUserId(userId),
    ]);

    const typePrefs = preferences.types[notification.type];

    // Send email if enabled
    if (preferences.email.enabled && typePrefs?.email) {
      await this.emailService.sendNotificationEmail(notification);
    }

    // Send push if enabled
    if (preferences.push.enabled && typePrefs?.push) {
      await this.pushService.sendPushNotification(userId, notification);
    }
  }
}
```

### Backend: WebSocketGateway

```typescript
@WebSocketGateway({ cors: true })
export class WebSocketGateway {
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, string[]>(); // userId -> socketIds

  @SubscribeMessage('authenticate')
  handleAuthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token: string }
  ) {
    try {
      const decoded = this.jwtService.verify(data.token);
      client.data.userId = decoded.sub;

      // Track socket for this user
      const socketIds = this.userSockets.get(decoded.sub) || [];
      socketIds.push(client.id);
      this.userSockets.set(decoded.sub, socketIds);

      return { success: true };
    } catch (error) {
      return { success: false, error: 'Invalid token' };
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId;
    if (userId) {
      const socketIds = this.userSockets.get(userId) || [];
      const filtered = socketIds.filter(id => id !== client.id);
      
      if (filtered.length === 0) {
        this.userSockets.delete(userId);
      } else {
        this.userSockets.set(userId, filtered);
      }
    }
  }

  sendToUser(userId: string, event: string, data: any) {
    const socketIds = this.userSockets.get(userId) || [];
    socketIds.forEach(socketId => {
      this.server.to(socketId).emit(event, data);
    });
  }
}
```

### Frontend: useNotifications

```typescript
export function useNotifications() {
  const { data, isLoading, refetch } = useQuery(
    ['notifications'],
    () => notificationApi.getNotifications({ limit: 20 }),
    { staleTime: 60000 } // 1 minute
  );

  const { mutate: markAsRead } = useMutation(
    (id: string) => notificationApi.markAsRead(id),
    {
      onSuccess: () => refetch(),
    }
  );

  const { mutate: markAllAsRead } = useMutation(
    () => notificationApi.markAllAsRead(),
    {
      onSuccess: () => refetch(),
    }
  );

  return {
    notifications: data?.items || [],
    unreadCount: data?.items.filter(n => !n.read).length || 0,
    isLoading,
    markAsRead,
    markAllAsRead,
    refetch,
  };
}
```

### Frontend: useWebSocket

```typescript
export function useWebSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const queryClient = useQueryClient();
  const { accessToken } = useAuth();

  useEffect(() => {
    if (!accessToken) return;

    const newSocket = io('ws://localhost:3000', {
      autoConnect: false,
    });

    newSocket.on('connect', () => {
      newSocket.emit('authenticate', { token: accessToken });
    });

    newSocket.on('notification:new', (notification: Notification) => {
      queryClient.setQueryData(['notifications'], (old: any) => {
        return {
          ...old,
          items: [notification, ...old.items],
        };
      });
      
      // Show toast
      toast.info(notification.title);
    });

    newSocket.on('notification:read', ({ id }: { id: string }) => {
      queryClient.setQueryData(['notifications'], (old: any) => {
        return {
          ...old,
          items: old.items.map((n: Notification) =>
            n.id === id ? { ...n, read: true } : n
          ),
        };
      });
    });

    newSocket.connect();
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [accessToken]);

  return socket;
}
```

---

## Testing

### Unit Tests

```typescript
describe('NotificationService', () => {
  let service: NotificationService;
  let repository: MockType<NotificationRepository>;
  let queue: MockType<Queue>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: NotificationRepository,
          useFactory: mockRepository,
        },
        {
          provide: 'BullQueue_notification',
          useFactory: mockQueue,
        },
      ],
    }).compile();

    service = module.get(NotificationService);
    repository = module.get(NotificationRepository);
    queue = module.get('BullQueue_notification');
  });

  it('should create and enqueue notification', async () => {
    const mockNotification = { id: '1', userId: '123', type: 'TASK_ASSIGNED' };
    repository.create.mockResolvedValue(mockNotification);

    await service.create('123', 'TASK_ASSIGNED', {
      title: 'New task',
      body: 'You have been assigned a task',
    });

    expect(queue.add).toHaveBeenCalledWith('process-notification', {
      notificationId: '1',
      userId: '123',
    });
  });
});
```

---

## Migration

```javascript
// Create notifications collection
db.createCollection('notifications');
db.notifications.createIndex({ userId: 1, createdAt: -1 });
db.notifications.createIndex({ userId: 1, read: 1 });

// Create preferences collection
db.createCollection('notification_preferences');
db.notification_preferences.createIndex({ userId: 1 }, { unique: true });
```
