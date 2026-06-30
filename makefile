T?=linux/amd64
TAG?=xendemo-$(T)-$(E)-priv

build-container:
	docker build --platform $(T) . -t $(TAG) 

get-image:
	docker run -ti -v "`pwd`:/repo" --rm $(TAG):latest /bin/bash -c "cp /root/boot/* /repo/boot"

rebuild:
	make build-container 
	make get-image 

enter-container:
	docker run -ti -p 5900:5900 -p 8080:6000 -v "`pwd`:/repo" --privileged --rm $(TAG):latest /bin/bash 


