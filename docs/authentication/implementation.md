# Authentication Implementation

---

## Folder Structure

```
backend/src/auth/
├── auth.controller.ts
├── auth.service.ts
├── auth.module.ts
├── jwt.service.ts
├── session.service.ts
├── guards/
│   ├── jwt-auth.guard.ts
│   ├── roles.guard.ts
│   └── rate-limit.guard.ts
├── strategies/
│   ├── jwt.strategy.ts
│   ├── google-oauth.strategy.ts
│   └── github-oauth.strategy.ts
├── dto/
│   ├── login.dto.ts
│   ├── register.dto.ts
│   └── refresh.dto.ts
├── decorators/
│   ├── current-user.decorator.ts
│   └── roles.decorator.ts
└── __tests__/
    ├── auth.service.spec.ts
    └── auth.controller.spec.ts

frontend/src/features/auth/
├── components/
│   ├── LoginForm.tsx
│   ├── RegisterForm.tsx
│   ├── OAuthButtons.tsx
│   └── MFASetup.tsx
├── hooks/
│   ├── useAuth.ts
│   └── useLogin.ts
├── pages/
│   ├── LoginPage.tsx
│   ├── RegisterPage.tsx
│   └── ForgotPasswordPage.tsx
├── context/
│   └── AuthProvider.tsx
└── api/
    └── authApi.ts
```

---

## Packages

### Backend

```json
{
  "dependencies": {
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "passport": "^0.6.0",
    "passport-jwt": "^4.0.1",
    "passport-google-oauth20": "^2.0.0",
    "bcrypt": "^5.1.0",
    "speakeasy": "^2.0.0",
    "qrcode": "^1.5.0",
    "ioredis": "^5.3.0"
  }
}
```

### Frontend

```json
{
  "dependencies": {
    "react-query": "^3.39.0",
    "zustand": "^4.3.0",
    "axios": "^1.4.0",
    "react-router-dom": "^6.11.0"
  }
}
```

---

## Code Snippets

### Backend: AuthService

```typescript
@Injectable()
export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private jwtService: JwtService,
    private sessionService: SessionService,
    private eventEmitter: EventEmitter2,
  ) {}

  async register(dto: RegisterDto): Promise<User> {
    const existingUser = await this.userRepository.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.userRepository.create({
      ...dto,
      passwordHash,
      roles: ['member'],
      emailVerified: false,
    });

    this.eventEmitter.emit('user.registered', { userId: user.id });
    return user;
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.validateUser(dto.email, dto.password);
    
    if (user.mfaEnabled && !dto.mfaToken) {
      throw new UnauthorizedException('MFA token required');
    }

    if (user.mfaEnabled) {
      const isValid = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: dto.mfaToken,
      });
      if (!isValid) {
        throw new UnauthorizedException('Invalid MFA token');
      }
    }

    const accessToken = this.jwtService.generateAccessToken(user);
    const refreshToken = this.jwtService.generateRefreshToken(user);
    
    await this.sessionService.createSession(user.id, refreshToken);
    
    this.eventEmitter.emit('user.logged_in', { userId: user.id });

    return {
      accessToken,
      refreshToken,
      user: this.sanitizeUser(user),
    };
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return user;
  }

  private sanitizeUser(user: User) {
    const { passwordHash, mfaSecret, ...sanitized } = user;
    return sanitized;
  }
}
```

### Backend: JwtAuthGuard

```typescript
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err, user, info) {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid token');
    }
    return user;
  }
}
```

### Backend: RolesGuard

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}
```

### Frontend: AuthProvider

```typescript
interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      // Validate and decode token
      const decoded = jwtDecode(token);
      if (decoded.exp * 1000 > Date.now()) {
        setAccessToken(token);
        fetchUser(decoded.sub);
      } else {
        refreshAccessToken();
      }
    }
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    setAccessToken(response.accessToken);
    setUser(response.user);
    localStorage.setItem('accessToken', response.accessToken);
  };

  const logout = async () => {
    await authApi.logout();
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem('accessToken');
  };

  const refreshAccessToken = async () => {
    try {
      const response = await authApi.refresh();
      setAccessToken(response.accessToken);
      localStorage.setItem('accessToken', response.accessToken);
    } catch (error) {
      logout();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        logout,
        isAuthenticated: !!accessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
```

### Frontend: useAuth Hook

```typescript
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

---

## Testing

### Unit Tests

```typescript
describe('AuthService', () => {
  let service: AuthService;
  let userRepository: MockType<UserRepository>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UserRepository,
          useFactory: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get(AuthService);
    userRepository = module.get(UserRepository);
  });

  describe('login', () => {
    it('should return access and refresh tokens', async () => {
      const mockUser = { id: '1', email: 'test@test.com', roles: ['member'] };
      userRepository.findByEmail.mockResolvedValue(mockUser);

      const result = await service.login({
        email: 'test@test.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe('test@test.com');
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      userRepository.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'test@test.com', password: 'wrong' })
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
```

### Integration Tests

```typescript
describe('AuthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/auth/login (POST)', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@test.com', password: 'password123' })
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('refreshToken');
      });
  });
});
```

---

## Migration

### Initial Schema

```javascript
// MongoDB migration: create users collection
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'passwordHash', 'roles'],
      properties: {
        email: { bsonType: 'string' },
        passwordHash: { bsonType: 'string' },
        roles: { bsonType: 'array' },
        orgId: { bsonType: 'objectId' },
        mfaEnabled: { bsonType: 'bool' },
        mfaSecret: { bsonType: 'string' },
        emailVerified: { bsonType: 'bool' },
      },
    },
  },
});

// Create indexes
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ orgId: 1 });
db.users.createIndex({ createdAt: 1 });
```

### Adding MFA (Example Migration)

```javascript
// Add mfaEnabled and mfaSecret fields to existing users
db.users.updateMany(
  { mfaEnabled: { $exists: false } },
  {
    $set: {
      mfaEnabled: false,
      mfaSecret: null,
    },
  }
);
```
