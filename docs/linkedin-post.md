# Sugestão de publicação no LinkedIn

Nos últimos tempos, tenho pensado bastante em como a tecnologia pode ser usada para resolver problemas que estão muito próximos da nossa realidade.

Um desses problemas é o desperdício de alimentos. Enquanto estabelecimentos descartam produtos que ainda estão próprios para consumo, muitas ONGs enfrentam dificuldades para encontrar e organizar doações de forma rápida, segura e rastreável.

Foi a partir dessa reflexão que comecei a desenvolver o **Food Rescue**, uma plataforma web que conecta estabelecimentos doadores a ONGs locais.

Nesta primeira versão, desenvolvi:

- cadastro de doadores, ONGs e administradores;
- publicação e busca de lotes de alimentos;
- solicitação, reserva e confirmação de resgates;
- controle de concorrência para impedir dois resgates do mesmo lote;
- autenticação com bcrypt, JWT e refresh tokens rotativos;
- controle de acesso por perfil, auditoria e cuidados com LGPD;
- notificações por e-mail usando o padrão Outbox;
- geração de comprovantes e relatórios em PDF;
- testes automatizados do fluxo crítico com Playwright;
- interface responsiva feita com JavaScript, HTML e CSS.

**Stack utilizada:** Node.js, Express, MySQL/MariaDB, JavaScript vanilla, HTML5, CSS3, Playwright, PDFKit e Nodemailer.

Um dos maiores aprendizados foi lidar com concorrência no banco de dados utilizando transações e `SELECT ... FOR UPDATE`, garantindo que o mesmo lote não seja reservado por duas ONGs simultaneamente.

O projeto **ainda não está finalizado**. Esta é apenas a primeira versão de um MVP que pretendo continuar evoluindo. Ainda quero trabalhar em infraestrutura, experiência do usuário, acessibilidade, observabilidade, testes de carga e outros pontos necessários para aproximá-lo de um ambiente real de produção.

Estou compartilhando o projeto justamente para aprender durante o processo. Por isso, **sugestões, críticas construtivas e ideias de melhoria são muito bem-vindas**. Se você trabalha com desenvolvimento, segurança, UX, terceiro setor ou logística de alimentos, ficarei feliz em ouvir sua opinião.

O código e a documentação estão disponíveis no GitHub: **https://github.com/geraldomartins-dev/food-rescue**

#NodeJS #JavaScript #MySQL #ExpressJS #Playwright #FullStack #SoftwareEngineering #TechForGood #OpenSource #Portfolio
