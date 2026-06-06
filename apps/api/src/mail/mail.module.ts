import { Global, Module } from "@nestjs/common";
import { AppConfig } from "../config/app-config";
import { MailService } from "./mail.service";
import { CapturingTransport, MAIL_TRANSPORT, SmtpTransport, type MailTransport } from "./transports";

@Global()
@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      useFactory: (config: AppConfig): MailTransport =>
        config.smtpUrl !== ""
          ? new SmtpTransport(config.smtpUrl, config.mailFrom)
          : new CapturingTransport(),
      inject: [AppConfig],
    },
    MailService,
  ],
  exports: [MailService, MAIL_TRANSPORT],
})
export class MailModule {}
